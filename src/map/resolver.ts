// 시뮬레이터 로그 이벤트 → 공용 레일 맵 위의 위치.
//
// 시뮬레이터의 노드 번호는 차량마다 다른 가상 트랙의 번호라서 맵과 직접 대응하지 않는다.
// 그래서 차량별로 "시뮬레이터 노드 → 맵 노드" 대응표를 주행하면서 점진적으로 만든다.
//   - 새 링크 a→b 명령(Go)이 오면, 현재 맵 노드에서 나가는 링크 중 종류(직선/곡선)가 맞는 것을 고른다.
//   - b 가 이미 대응돼 있고 인접하면 그 링크를 쓴다. 인접하지 않으면 대응을 새로 덮어쓴다.
//     (순간이동 없이 항상 레일을 따라 이어지게 하는 쪽을 우선한다.)
//   - 링크 안 진행률은 로그의 진행 거리(pos)와 남은 거리(rem)로 계산한다.
// 결과적으로 차량은 맵 위를 끊김 없이 움직이지만, 시뮬레이터 트랙과 맵 경로가 1:1 로 같지는 않다.

import type { LogEvent } from './logParser';
import { poseOnLink, zoneAt, type MapLink, type RailMap, type Pose } from './railMap';

interface RouteLink { a: number; b: number; len: number; type: string; map: MapLink; /** Go 명령보다 상태 줄을 먼저 봐서 임시로 만든 링크 */ provisional?: boolean }

interface VehicleState {
  simToMap: Map<number, number>;
  cur: MapLink | null;
  progress: number;
  driving: boolean;
  vel: number;
  route: RouteLink[];
  cum: number[];                   // 경로 시작부터 각 링크 시작까지 누적 거리(mm)
  lastPos: number;
  lastTime: number;
  /** 경로 줄로 받은 이번 경로의 링크 수 (모르면 -1) */
  planned: number;
}

export interface VehiclePosition extends Pose { linkId: number; progress: number; driving: boolean; vel: number }

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface ResolverOptions {
  /** 그 자리에 멈춰 있는 차량(오류·무수신). 다른 차량 길을 막지 않도록 닫힌 구역에 둔다 */
  parked?: string[];
  /** 다른 차량이 들어가지 않는 구역(멈춘 차량을 두는 곳) */
  closedZone?: string;
}

export class PositionResolver {
  private states = new Map<string, VehicleState>();
  /** 출발 위치를 이미 정한 차량들의 좌표 (서로 겹치지 않게 띄우기 위해) */
  private placed: Pose[] = [];
  private parked: string[];
  private closedZone: string | null;
  constructor(private map: RailMap, opts: ResolverOptions = {}) {
    this.parked = opts.parked ?? [];
    this.closedZone = opts.closedZone ?? null;
  }

  private linkZone(l: MapLink) { const p = poseOnLink(this.map, l, 0.5); return zoneAt(this.map, p.x, p.y); }
  /** 닫힌 구역으로 들어가는 링크인지. 연결 링크(connector)는 여러 마디라 끝까지 따라가 본다 */
  private closed(l: MapLink): boolean {
    if (!this.closedZone) return false;
    let cur = l;
    for (let k = 0; k < 50; k++) {
      const n = this.map.nodeById.get(cur.to)!;
      if (zoneAt(this.map, n.x, n.y) === this.closedZone && cur.kind !== 'main') return true;
      if (cur.kind !== 'connector') return false;
      const next = (this.map.outgoing.get(cur.to) ?? [])[0];
      if (!next) return false;
      cur = next;
    }
    return false;
  }

  /** 출발 링크: 멈춘 차량은 닫힌 구역 루프에 나눠 두고, 나머지는 닫힌 구역 밖에서 다른 차량과 4 m 이상 떨어진 곳을 고른다 */
  private startLink(id: string): MapLink {
    const pi = this.parked.indexOf(id);
    if (pi >= 0 && this.closedZone) {
      const bay = this.map.links.filter(l => l.kind === 'bay' && this.linkZone(l) === this.closedZone);
      if (bay.length) return bay[Math.floor(((pi + 0.5) * bay.length) / this.parked.length)];
    }
    const links = this.map.links.filter(l => l.kind !== 'connector' && (!this.closedZone || this.linkZone(l) !== this.closedZone));
    const h = hash(id);
    for (let k = 0; k < links.length; k++) {
      const l = links[(h + k * 7) % links.length];
      const p = poseOnLink(this.map, l, 0.5);
      if (this.placed.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= 4)) return l;
    }
    return links[h % links.length];
  }

  /** 지금 구간에서 시뮬레이터 1 mm 가 맵에서 몇 mm 인지. 짧은 시뮬레이터 링크가 이어지면 그중 가장 큰 값 */
  scaleAt(id: string, linkId: number): number {
    const s = this.states.get(id);
    if (!s) return 1;
    const i = s.route.findIndex(r => r.map.id === linkId);
    if (i < 0) return 1;
    let m = 0;
    for (const r of s.route.slice(i, i + 3)) m = Math.max(m, (r.map.length * 1000) / Math.max(1, r.len));
    return m || 1;
  }

  /** 지금 링크(linkId) 다음으로 지나갈 것으로 정해진 맵 링크들 */
  pathAhead(id: string, linkId: number): { links: MapLink[]; more: boolean } {
    const s = this.states.get(id);
    if (!s) return { links: [], more: false };
    const i = s.route.findIndex(r => r.map.id === linkId);
    // more: 경로가 아직 다 정해지지 않아(다음 링크 명령 전) 뒤로 더 이어지는지
    const more = s.planned < 0 || s.route.length < s.planned;
    return { links: i >= 0 ? s.route.slice(i + 1).map(r => r.map) : [], more };
  }

  private state(id: string): VehicleState {
    let s = this.states.get(id);
    if (!s) {
      // 시작 링크는 차량 ID 해시로 고르되, 같은 ID면 항상 같은 자리에서 출발한다.
      const cur = this.startLink(id);
      this.placed.push(poseOnLink(this.map, cur, 0.5));
      s = { simToMap: new Map(), cur, progress: 0.5, driving: false, vel: 0, route: [], cum: [0], lastPos: 0, lastTime: 0, planned: -1 };
      this.states.set(id, s);
    }
    return s;
  }

  /** 시뮬레이터 링크 a→b 에 대응하는 맵 링크를 고른다. */
  private assign(id: string, s: VehicleState, a: number, b: number, type: string): MapLink {
    // 항상 차량이 지금 있는 맵 위치(마지막 링크의 끝 노드)에서 이어 간다.
    // 시뮬레이터 트랙과 맵의 루프가 다르므로 예전 대응(simToMap)을 출발점으로 쓰면 순간이동이 생긴다.
    const fromNode = s.route.length ? s.route[s.route.length - 1].map.to : s.cur ? s.cur.to : this.map.links[0].to;
    const all = this.map.outgoing.get(fromNode) ?? [];
    if (all.length === 0) return s.cur ?? this.map.links[0];
    // 닫힌 구역(멈춘 차량이 있는 곳)으로는 들어가지 않는다
    const open = all.filter(l => !this.closed(l));
    const out = open.length ? open : all;
    const known = s.simToMap.get(b);
    let pick = known !== undefined ? out.find(l => l.to === known) : undefined;
    if (!pick) {
      const same = out.filter(l => l.type === type);
      const pool = same.length ? same : out.filter(l => l.type === 'Straight').length ? out.filter(l => l.type === 'Straight') : out;
      // 분기점에서는 차량과 노드 번호의 해시로 고른다. 같은 차량이 같은 트랙을 돌면 같은 선택이 나온다.
      // 베이로 들어가는 분기(connector)는 70% 확률로 우선해, 차량이 외곽 루프에만 몰리지 않게 한다.
      const h = hash(`${id}:${a}>${b}`);
      const bayIn = pool.filter(l => l.kind === 'connector'), rest = pool.filter(l => l.kind !== 'connector');
      const group = bayIn.length && rest.length ? (h % 100 < 70 ? bayIn : rest) : pool;
      pick = group[(h >>> 8) % group.length];
    }
    s.simToMap.set(a, fromNode);
    s.simToMap.set(b, pick.to);
    return pick;
  }

  apply(id: string, ev: LogEvent) {
    const s = this.state(id);
    switch (ev.kind) {
      case 'route': {
        // 상태 줄을 먼저 봐서 만든 임시 링크가 새 경로의 첫 링크와 같으면 그대로 둔다.
        const first = s.route[0];
        const keep = s.route.length === 1 && first.provisional && first.a === ev.nodes[0] && first.b === ev.nodes[1];
        if (!keep) { s.route = []; s.cum = [0]; }
        s.lastPos = 0;
        s.planned = ev.nodes.length - 1;
        break;
      }
      case 'go': {
        const last = s.route[s.route.length - 1];
        if (last && last.provisional && last.a === ev.a && last.b === ev.b) {
          // 임시 링크에 실제 길이·종류를 채운다. 맵 대응은 이미 차량이 그 위에 있으므로 유지한다.
          last.len = ev.distance; last.type = ev.type; last.provisional = false;
          s.cum[s.cum.length - 1] = s.cum[s.cum.length - 2] + ev.distance;
          s.driving = true;
          break;
        }
        const map = this.assign(id, s, ev.a, ev.b, ev.type);
        s.route.push({ a: ev.a, b: ev.b, len: ev.distance, type: ev.type, map });
        s.cum.push(s.cum[s.cum.length - 1] + ev.distance);
        if (!s.driving) { s.cur = map; s.progress = 0; }
        s.driving = true;
        break;
      }
      case 'status': {
        s.driving = ev.driving;
        s.vel = ev.driving ? ev.vel : 0;
        s.lastTime = ev.time;
        if (!ev.driving) { s.progress = Math.min(1, s.progress); break; }
        let i = s.route.findIndex(r => r.a === ev.cur && r.b === ev.nxt);
        if (i < 0) {
          // 경로에 없는 링크. 경로 끝 노드에서 출발했거나 진행 거리가 되돌아갔으면 새 경로가 시작된 것이다
          // (시뮬레이터는 경로 줄보다 상태 줄을 먼저 내보낼 수 있다). 그 밖의 경우는 이전 위치를 유지한다.
          const routeEnd = s.route.length ? s.route[s.route.length - 1].b : null;
          const restarted = s.route.length === 0 || ev.cur === routeEnd || ev.pos < s.lastPos - 1;
          if (!restarted) break;
          s.route = []; s.cum = [0]; s.planned = -1;
          const map = this.assign(id, s, ev.cur, ev.nxt, 'Straight');
          const len = Math.max(1, ev.pos + ev.rem);        // 첫 링크에서는 진행 거리 + 남은 거리 = 링크 길이
          s.route.push({ a: ev.cur, b: ev.nxt, len, type: 'Straight', map, provisional: true });
          s.cum.push(len);
          i = 0;
        }
        const r = s.route[i];
        s.cur = r.map;
        s.progress = r.len > 0 ? Math.min(1, Math.max(0, 1 - ev.rem / r.len)) : 1;
        s.lastPos = ev.pos;
        break;
      }
      case 'arrived':
        s.driving = false;
        s.vel = 0;
        s.progress = 1;
        break;
    }
  }

  /** 마지막 이벤트 이후 흐른 시간만큼 보간한 위치. 로그가 0.2 초 간격이라 그 사이를 매끄럽게 잇는다. */
  /** @param liveVel 데모에서 구동기의 지금 속도(mm/s). 주면 마지막 로그의 속도 대신 이 값으로 보간한다(정지 직후 앞으로 미끄러지지 않게) */
  position(id: string, now?: number, liveVel?: number): VehiclePosition {
    const s = this.state(id);
    let link = s.cur ?? this.map.links[0];
    let t = s.progress;
    const vel = liveVel ?? s.vel;
    if (s.driving && now !== undefined && s.lastTime > 0 && vel > 0) {
      const dt = Math.min(0.5, Math.max(0, (now - s.lastTime) / 1000));
      // 진행률은 시뮬레이터 링크 길이 기준으로 보간한다(상태 줄의 진행률 계산과 같은 기준)
      const simLen = s.route.find(r => r.map === link)?.len ?? link.length * 1000;
      t += (vel * dt) / Math.max(1, simLen);
      // 보간이 링크 끝을 넘으면 다음 링크로 조금 넘어가되, 경로를 벗어나지는 않는다.
      if (t > 1) {
        const idx = s.route.findIndex(r => r.map === link);
        const next = idx >= 0 && idx + 1 < s.route.length ? s.route[idx + 1].map : null;
        if (next && next.from === link.to) { t = Math.min(1, t - 1); link = next; } else t = 1;
      }
    }
    const p = poseOnLink(this.map, link, t);
    return { ...p, linkId: link.id, progress: t, driving: s.driving, vel: s.vel };
  }

  has(id: string) { return this.states.has(id); }
  ids() { return [...this.states.keys()]; }
}
