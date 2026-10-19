// 차량끼리 서로 통과하지 못하게 하는 간격 제어 (데모용).
//
// 실제 OHT 는 레일 위에서 앞 차량을 추월하거나 겹쳐 지나갈 수 없다. 데모 차량은 시뮬레이터처럼 각자의 가상 트랙을 돌고
// 맵 위치는 그 결과를 옮긴 것이라, 그대로 두면 맵 위에서 서로 겹친다. 그래서 맵 위에서
//   1) 차량마다 앞으로 지나갈 길(정해진 경로, 없으면 갈 수 있는 모든 가지)을 일정 간격으로 찍어 두고,
//   2) 다른 차량의 지금 차체가 그 길과 겹치면 그 앞에서 멈추고,
//   3) 두 차량이 앞으로 지나갈 길이 서로 겹치면(합류·분기·가까이 붙은 레일) 겹치는 곳에 더 가까운 차량이 먼저 간다.
// 이렇게 정한 속도 상한(mm/s)을 데모 구동기에 넣어 실제로 감속·정지하게 하므로 로그에도 그대로 나타난다(주행 중 속도 0 = 대기).

import { poseOnLink, type MapLink, type RailMap } from './railMap';

/** 차량 중심 사이 이 거리(m)보다 가까우면 차체가 겹친다고 본다. 맵 위 차체 약 2 m × 1.3 m + 여유 */
export const CLEAR = 2.4;
/** 간격 때문에 감속할 때의 감속도(맵 기준 mm/s²) */
export const TRAFFIC_DEC = 3500;
/** 맵 위 최고 속도(m/s). 시뮬레이터 링크가 맵 링크보다 훨씬 짧으면 맵에서 순간이동처럼 보이므로 막는다 */
const V_MAP_MAX = 4.5;
/** 앞을 살피는 거리(m)와 찍는 간격(m) */
const LOOK = 6;
const STEP = 0.35;
/** 위치 보고 지연을 감안한 여유(초) */
const LATENCY = 0.3;

export interface TrafficVehicle { id: string; linkId: number; progress: number; driving: boolean; vel: number }
type Sample = { x: number; y: number; s: number };

/**
 * 지금 위치부터 앞으로 LOOK m 까지의 길을 STEP 간격으로 찍는다. 첫 점(s=0)은 지금 위치.
 * 정해진 경로 너머는 경로가 이어질 때(more)만 한 링크까지, 갈 수 있는 모든 가지를 찍는다(경로가 끝나면 거기서 멈추므로 보지 않는다).
 */
function samplePath(map: RailMap, cur: MapLink, progress: number, known: MapLink[], more: boolean): Sample[] {
  const out: Sample[] = [];
  const p0 = poseOnLink(map, cur, progress);
  out.push({ x: p0.x, y: p0.y, s: 0 });
  const stack: Array<{ link: MapLink; from: number; dist: number; idx: number | null }> = [{ link: cur, from: progress * cur.length, dist: -progress * cur.length, idx: 0 }];
  const knownStart = known.length && known[0].from === cur.to;
  while (stack.length) {
    const f = stack.pop()!;
    const len = f.link.length;
    for (let d = Math.ceil((f.from + 1e-6) / STEP) * STEP; d <= len; d += STEP) {
      const s = f.dist + d;
      if (s > LOOK) break;
      if (s <= 0) continue;
      const p = poseOnLink(map, f.link, d / len);
      out.push({ x: p.x, y: p.y, s });
    }
    const endDist = f.dist + len;
    if (endDist >= LOOK) continue;
    if (f.idx === null) continue;                    // 정해지지 않은 가지는 한 링크만
    const planned = f.idx < known.length && known[f.idx].from === f.link.to ? known[f.idx] : null;
    const next = planned ? [planned] : more && (f.idx === known.length || !knownStart) ? map.outgoing.get(f.link.to) ?? [] : [];
    for (const l of next) stack.push({ link: l, from: 0, dist: endDist, idx: planned ? (f.idx as number) + 1 : null });
  }
  return out;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 지금 막혀 있는(더 갈 거리가 거의 없는) 대기 관계에서 순환을 이루는 차량 묶음들 (타잔 SCC) */
function cycles(waits: Map<string, Array<{ by: string; room: number }>>): string[][] {
  const edges = new Map<string, string[]>();
  for (const [id, ws] of waits) edges.set(id, [...new Set(ws.filter(w => w.room <= 0.4).map(w => w.by))]);
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp);
    }
  };
  for (const v of edges.keys()) if (!idx.has(v)) visit(v);
  return out;
}

/**
 * 주행 중인 차량마다 속도 상한(시뮬레이터 기준 mm/s)을 돌려준다.
 * @param pathOf 지금 링크 다음으로 정해진 맵 링크들
 * @param scaleOf 지금 구간에서 시뮬레이터 1 mm 가 맵에서 몇 mm 인지 (맵 링크 길이 / 시뮬레이터 링크 길이)
 * @param order 두 차량 사이에 정해 둔 통과 순서("a|b" → 먼저 가는 차량). 틱 사이에 유지되도록 호출하는 쪽이 들고 있는다
 */
export function trafficCaps(map: RailMap, vs: TrafficVehicle[], pathOf: (id: string, linkId: number) => { links: MapLink[]; more: boolean }, scaleOf: (id: string, linkId: number) => number, order: Map<string, string> = new Map(), debug?: Map<string, unknown>): Map<string, number> {
  const seen = new Set<string>();
  const samples = new Map<string, Sample[]>();
  for (const v of vs) {
    const cur = map.linkById.get(v.linkId);
    if (!cur) continue;
    if (v.driving) { const p = pathOf(v.id, v.linkId); samples.set(v.id, samplePath(map, cur, v.progress, p.links, p.more)); }
    else { const p = poseOnLink(map, cur, v.progress); samples.set(v.id, [{ x: p.x, y: p.y, s: 0 }]); }
  }
  const d2 = (a: Sample, b: Sample) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const near = (a: Sample, b: Sample) => d2(a, b) < CLEAR * CLEAR;
  /** 차량별로 누구 때문에 얼마나 더 갈 수 있는지(room, m). prio = 합류 양보, 아니면 앞 차체 */
  const waits = new Map<string, Array<{ by: string; room: number; prio: boolean }>>();

  for (const a of vs) {
    if (!a.driving) continue;
    const sa = samples.get(a.id);
    if (!sa) continue;
    const list: Array<{ by: string; room: number; prio: boolean }> = [];
    waits.set(a.id, list);
    for (const b of vs) {
      if (b === a) continue;
      const sb = samples.get(b.id);
      if (!sb) continue;
      if (Math.hypot(sa[0].x - sb[0].x, sa[0].y - sb[0].y) > LOOK * 2 + CLEAR) continue;
      // 1) 다른 차량의 지금 차체가 내 앞길에 있으면 그 앞에서 멈춘다
      //    (뒤에 바짝 붙은 차량은 제외: 그 차량은 내 지금 위치보다 앞길에 더 가까워야 앞에 있는 것이다)
      for (let i = 1; i < sa.length; i++) if (near(sa[i], sb[0]) && d2(sa[i], sb[0]) < d2(sa[0], sb[0])) { list.push({ by: b.id, room: sa[i].s - STEP, prio: false }); break; }
      if (!b.driving || sb.length < 2) continue;
      // 2) 앞으로 지나갈 길끼리 겹치면, 겹치는 곳에 더 가까운 차량이 먼저 간다 (두 차량이 같은 판단을 하도록 합이 가장 작은 지점으로 정한다)
      let bestSum = Infinity, bestA = 0, bestB = 0, firstA = Infinity;
      for (let i = 1; i < sa.length; i++) {
        for (let j = 1; j < sb.length; j++) {
          if (!near(sa[i], sb[j])) continue;
          if (sa[i].s < firstA) firstA = sa[i].s;
          if (sa[i].s + sb[j].s < bestSum) { bestSum = sa[i].s + sb[j].s; bestA = sa[i].s; bestB = sb[j].s; }
        }
      }
      if (bestSum < Infinity) {
        // 한 번 정한 순서는 두 차량의 길이 더는 겹치지 않을 때까지 유지한다(서로 다가가며 판단이 뒤집히면 둘 다 들어가 버린다)
        const key = pairKey(a.id, b.id);
        seen.add(key);
        let winner = order.get(key);
        if (!winner) { winner = bestB < bestA || (bestB === bestA && b.id < a.id) ? b.id : a.id; order.set(key, winner); }
        if (winner === b.id) list.push({ by: b.id, room: firstA - STEP, prio: true });
      }
    }
  }

  // 서로의 차체가 서로의 앞길에 걸린 경우(합류 직전에 둘 다 가까워진 경우)에는 순서상 앞선 차량만 간다
  for (const [a, list] of waits) {
    for (const w of list) {
      if (w.prio) continue;
      const back = waits.get(w.by)?.find(x => !x.prio && x.by === a);
      if (!back) continue;
      const key = pairKey(a, w.by);
      seen.add(key);
      let winner = order.get(key);
      if (!winner) { winner = w.room < back.room || (w.room === back.room && a < w.by) ? a : w.by; order.set(key, winner); }
      if (winner === a) w.room = Infinity;
    }
  }
  for (const key of [...order.keys()]) if (!seen.has(key)) order.delete(key);

  // 서로가 서로를 기다리는 순환(교착)이 생기면, 순환 안에서 양보 때문에만 기다리는 차량 중 ID 가 가장 앞선 차량이 양보를 거두고 먼저 간다.
  // 앞 차체 때문에 막힌 대기는 풀지 않는다(풀면 차량이 겹친다).
  const ignore = new Set<string>();
  for (const comp of cycles(waits)) {
    const inComp = new Set(comp);
    // 풀어 줬을 때 실제로 움직일 수 있는 차량: 순환 안에서 막혀 있는 이유가 양보뿐인 차량
    const yielders = comp.filter(id => {
      const binding = (waits.get(id) ?? []).filter(w => w.room <= 0.4 && inComp.has(w.by));
      return binding.length > 0 && binding.every(w => w.prio);
    }).sort();
    const x = yielders[0];
    if (!x) continue;
    for (const w of waits.get(x) ?? []) if (w.prio && inComp.has(w.by)) ignore.add(`${x}>${w.by}`);
  }

  if (debug) { debug.set("waits", waits); debug.set("ignore", ignore); }
  const caps = new Map<string, number>();
  for (const a of vs) {
    const list = waits.get(a.id);
    if (!list) continue;
    let room = Infinity;
    for (const w of list) if (!(w.prio && ignore.has(`${a.id}>${w.by}`))) room = Math.min(room, w.room);   // 순환을 풀 때는 양보 대기만 거둔다
    const r = Math.max(0.05, scaleOf(a.id, a.linkId));
    let cap = (V_MAP_MAX * 1000) / r;
    if (room < Infinity) {
      const roomMm = (room - ((a.vel * r) / 1000) * LATENCY) * 1000;
      cap = Math.min(cap, roomMm <= 0 ? 0 : Math.sqrt((2 * TRAFFIC_DEC * roomMm) / r));
    }
    caps.set(a.id, cap);
  }
  return caps;
}
