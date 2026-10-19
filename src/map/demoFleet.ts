// 데모용 차량 구동기.
//
// 아직 수집 서버가 없으므로, 시뮬레이터(ohtsim)와 같은 방식으로 차량마다 가상 트랙을 만들고
// 시뮬레이터가 내보내는 것과 같은 모양의 이벤트(route / go / status / arrived)를 만들어
// PositionResolver 에 넣는다. 실제 로그가 연결되면 이 파일 대신 logParser.parseLine 결과를 넣으면 된다.
//
// 가상 트랙 분포는 시뮬레이터 map_stats.json 을 따른다(직선 76%, 우회전 14%, 좌회전·유턴 각 5%).

import type { LogEvent, LinkTypeName } from './logParser';
import { CMD } from '../logs/messages';
import { TRAFFIC_DEC } from './traffic';

export type DemoStatus = '운행' | '대기' | '경고' | '오류' | '무수신';

interface TrackLink { a: number; b: number; len: number; speed: number; type: LinkTypeName }

interface DemoVehicle {
  id: string;
  rng: () => number;
  track: TrackLink[];
  byFrom: Map<number, TrackLink>;
  node: number;
  driving: boolean;
  route: TrackLink[];
  cum: number[];
  s: number;            // 경로 시작부터 진행 거리(mm)
  v: number;            // mm/s
  linkIdx: number;
  commanded: number;    // Go 를 보낸 링크 수
  stopUntil: number;
  nextStatus: number;
  fault: DemoStatus | null;
}

export interface DemoOptions {
  count: number;
  seed?: number;
  /** 고장·경고로 고정할 차량 (status 는 '경고' | '오류') */
  faults?: Record<string, DemoStatus>;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T extends string>(rng: () => number, dist: Record<T, number>): T {
  const keys = Object.keys(dist) as T[];
  let r = rng() * keys.reduce((a, k) => a + dist[k], 0);
  for (const k of keys) { r -= dist[k]; if (r <= 0) return k; }
  return keys[keys.length - 1];
}

const TYPE_SHARE: Record<LinkTypeName, number> = { Straight: 0.7619, RightCurve: 0.1429, LeftCurve: 0.0476, Uturn: 0.0476 };
const LEN: Record<LinkTypeName, [number, number, number]> = { Straight: [45, 2964, 1616], RightCurve: [1519, 2422, 1885], LeftCurve: [1304, 1367, 1335], Uturn: [2474, 2498, 2486] };
const SPEED: Record<LinkTypeName, Record<string, number>> = {
  Straight: { '3300': 0.625, '4000': 0.125, '1500': 0.125, '500': 0.0625, '2500': 0.0312, '700': 0.0312 },
  RightCurve: { '700': 0.6667, '500': 0.3333 }, LeftCurve: { '700': 0.5, '500': 0.5 }, Uturn: { '700': 0.5, '400': 0.5 },
};
const ACC = 2000, DEC = 2000;      // mm/s²

function triangular(rng: () => number, lo: number, hi: number, mode: number) {
  const u = rng(), c = (mode - lo) / (hi - lo);
  return u < c ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

function makeTrack(rng: () => number, n = 40): TrackLink[] {
  // 노드 번호는 시뮬레이터처럼 1..85 범위의 무작위 번호
  const ids = new Set<number>();
  while (ids.size < n) ids.add(1 + Math.floor(rng() * 85));
  const nodes = [...ids];
  return nodes.map((a, i) => {
    const type = pick(rng, TYPE_SHARE);
    const [lo, hi, mode] = LEN[type];
    return { a, b: nodes[(i + 1) % n], len: Math.round(triangular(rng, lo, hi, mode)), speed: +pick(rng, SPEED[type]), type };
  });
}

export class DemoFleet {
  readonly vehicles: DemoVehicle[] = [];
  readonly faults: Record<string, DemoStatus>;
  /** 앞 차량과의 간격 때문에 걸린 속도 상한(mm/s). 맵 위 간격 제어(traffic.ts)가 매 틱 넣는다 */
  private caps = new Map<string, number>();

  constructor(opts: DemoOptions, private t0: number) {
    const base = opts.seed ?? 1;
    this.faults = opts.faults ?? {};
    for (let i = 0; i < opts.count; i++) {
      const id = `OHT-${String(i + 1).padStart(4, '0')}`;
      const rng = mulberry(base * 7919 + i);
      const track = makeTrack(rng);
      const v: DemoVehicle = {
        id, rng, track, byFrom: new Map(track.map(l => [l.a, l])), node: track[Math.floor(rng() * track.length)].a,
        driving: false, route: [], cum: [0], s: 0, v: 0, linkIdx: 0, commanded: 0,
        stopUntil: t0 + rng() * 6000, nextStatus: t0 + rng() * 500, fault: this.faults[id] ?? null,
      };
      this.vehicles.push(v);
    }
  }

  setCaps(caps: Map<string, number>) { this.caps = caps; }

  status(v: DemoVehicle): DemoStatus { return v.fault ?? (v.driving ? '운행' : '대기'); }

  /** t0 이후 now 까지 진행시키고, 그 사이 발생한 이벤트를 차량별로 돌려준다. */
  step(now: number, dtMs: number): Array<[string, LogEvent]> {
    const out: Array<[string, LogEvent]> = [];
    const dt = dtMs / 1000;
    for (const v of this.vehicles) {
      if (v.fault === '오류') {               // 오류 차량은 그 자리에 멈춰 있다
        if (now >= v.nextStatus) { out.push([v.id, this.statusEvent(v, now)]); v.nextStatus = now + 512; }
        continue;
      }
      if (v.fault === '무수신') {             // 무수신 차량: 처음 15초만 대기 상태를 보내고 그 뒤로는 아무 로그도 내지 않는다
        if (now < this.t0 + 15000 && now >= v.nextStatus) { out.push([v.id, this.statusEvent(v, now)]); v.nextStatus = now + 512; }
        continue;
      }
      if (!v.driving) {
        if (now >= v.stopUntil) this.startRoute(v, now, out);
        else if (now >= v.nextStatus) { out.push([v.id, this.statusEvent(v, now)]); v.nextStatus = now + 512; }
        continue;
      }
      // 속도 계획: 링크 제한 속도까지 가속, 경로 끝에서 정지하도록 감속
      const end = v.cum[v.cum.length - 1];
      const lk = v.route[v.linkIdx];
      let vmax = lk.speed;
      const remRoute = end - v.s;
      vmax = Math.min(vmax, Math.sqrt(2 * DEC * Math.max(0, remRoute)));
      if (v.linkIdx + 1 < v.route.length) {
        const nxt = v.route[v.linkIdx + 1];
        const toNext = v.cum[v.linkIdx + 1] - v.s;
        vmax = Math.min(vmax, Math.sqrt(nxt.speed ** 2 + 2 * DEC * Math.max(0, toNext)));
      }
      // 앞 차량 때문에 속도 상한이 걸리면 그 아래로 감속한다(필요하면 더 세게)
      const cap = this.caps.get(v.id);
      if (cap !== undefined) vmax = Math.min(vmax, cap);
      v.v = v.v < vmax ? Math.min(vmax, v.v + ACC * dt) : Math.max(vmax, v.v - (cap !== undefined ? TRAFFIC_DEC : DEC) * dt);
      v.s += v.v * dt;
      // 다음 링크 명령은 현재 링크의 30% 지점을 지나면 보낸다(시뮬레이터와 같은 후속 명령 타이밍)
      if (v.commanded < v.route.length && v.commanded === v.linkIdx + 1 && v.s >= v.cum[v.linkIdx] + 0.3 * lk.len) {
        out.push([v.id, this.goEvent(v, now, v.commanded)]); v.commanded++;
      }
      while (v.linkIdx + 1 < v.route.length && v.s >= v.cum[v.linkIdx + 1]) v.linkIdx++;
      if (v.s >= end - 0.5) {
        v.s = end; v.v = 0; v.driving = false; v.node = v.route[v.route.length - 1].b;
        out.push([v.id, { kind: 'arrived', time: now }]);
        v.stopUntil = now + 1500 + Math.exp(Math.log(8000) + (v.rng() - 0.5) * 2.4);   // 정차 1.5초 ~ 수십 초
        continue;
      }
      if (now >= v.nextStatus) { out.push([v.id, this.statusEvent(v, now)]); v.nextStatus = now + 208; }
    }
    return out;
  }

  private startRoute(v: DemoVehicle, now: number, out: Array<[string, LogEvent]>) {
    const n = 2 + Math.floor(v.rng() * 14);         // 경로 링크 수 2~15
    const route: TrackLink[] = [];
    let node = v.node;
    for (let i = 0; i < n; i++) { const l = v.byFrom.get(node)!; route.push(l); node = l.b; }
    v.route = route;
    v.cum = route.reduce<number[]>((c, l) => (c.push(c[c.length - 1] + l.len), c), [0]);
    v.s = 0; v.v = 0; v.linkIdx = 0; v.driving = true;
    out.push([v.id, { kind: 'route', time: now, nodes: [route[0].a, ...route.map(l => l.b)], total: v.cum[v.cum.length - 1] }]);
    out.push([v.id, this.goEvent(v, now, 0)]);
    v.commanded = 1;
    v.nextStatus = now;
  }

  private goEvent(v: DemoVehicle, time: number, i: number): LogEvent {
    const l = v.route[i];
    return { kind: 'go', time, cmd: i === 0 ? CMD.first : CMD.next, a: l.a, b: l.b, distance: l.len, speed: l.speed, type: l.type };
  }

  private statusEvent(v: DemoVehicle, time: number): LogEvent {
    const lk = v.driving ? v.route[v.linkIdx] : null;
    return {
      kind: 'status', time, driving: v.driving, cur: lk ? lk.a : v.node, nxt: lk ? lk.b : v.node,
      dest: v.route.length ? v.route[v.route.length - 1].b : v.node, vel: Math.round(v.v),
      rem: lk ? Math.round(Math.max(-35, v.cum[v.linkIdx + 1] - v.s)) : 0, pos: +v.s.toFixed(1),
    };
  }
}
