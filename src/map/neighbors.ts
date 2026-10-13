// 레일 위 앞·뒤 차량 찾기.
//
// 위치 변환기(resolver)가 차량마다 "어느 링크의 몇 % 지점"인지를 주므로, 레일 맵의 링크 연결을 따라
// 진행 방향으로 가장 가까운 차량(앞)과 반대 방향으로 가장 가까운 차량(뒤)을 거리(m)와 함께 찾는다.
// 분기점에서는 모든 가지를 탐색해 가장 가까운 차량을 고른다. 거리는 레일을 따라 잰 값이다.

import type { MapLink, RailMap } from './railMap';

export interface Positioned { id: string; linkId: number; progress: number }
export interface Neighbor { id: string; distance: number }
export interface RailNeighbors { ahead: Neighbor | null; behind: Neighbor | null }

const incomingCache = new WeakMap<RailMap, Map<number, MapLink[]>>();
function incoming(map: RailMap): Map<number, MapLink[]> {
  let m = incomingCache.get(map);
  if (!m) {
    m = new Map();
    for (const l of map.links) { if (!m.has(l.to)) m.set(l.to, []); m.get(l.to)!.push(l); }
    incomingCache.set(map, m);
  }
  return m;
}

/**
 * 차량 `id` 의 앞·뒤 차량. maxDist(m) 안에 없으면 null.
 * 같은 링크 위의 차량을 먼저 보고, 없으면 링크 끝(앞) 또는 링크 시작(뒤)에서 레일을 따라 탐색한다.
 */
export function railNeighbors(map: RailMap, vehicles: Positioned[], id: string, maxDist = 250): RailNeighbors {
  const me = vehicles.find(v => v.id === id);
  if (!me || !map.linkById.has(me.linkId)) return { ahead: null, behind: null };
  const onLink = new Map<number, Positioned[]>();
  for (const v of vehicles) { if (v.id === id) continue; if (!onLink.has(v.linkId)) onLink.set(v.linkId, []); onLink.get(v.linkId)!.push(v); }
  const myLink = map.linkById.get(me.linkId)!;
  const myProgress = me.progress, myLinkId = me.linkId;

  function search(dir: 'ahead' | 'behind'): Neighbor | null {
    // 같은 링크
    let best: Neighbor | null = null;
    for (const v of onLink.get(myLinkId) ?? []) {
      const d = dir === 'ahead' ? (v.progress - myProgress) * myLink.length : (myProgress - v.progress) * myLink.length;
      if (d >= 0 && (!best || d < best.distance)) best = { id: v.id, distance: d };
    }
    if (best) return best;
    // 레일을 따라 탐색 (거리 오름차순)
    const start = dir === 'ahead' ? myLink.to : myLink.from;
    const d0 = dir === 'ahead' ? (1 - myProgress) * myLink.length : myProgress * myLink.length;
    const queue: Array<{ node: number; dist: number }> = [{ node: start, dist: d0 }];
    const seen = new Map<number, number>([[start, d0]]);
    const inc = incoming(map);
    while (queue.length) {
      queue.sort((a, b) => a.dist - b.dist);
      const { node, dist } = queue.shift()!;
      if (best && dist >= best.distance) break;
      if (dist > maxDist) break;
      const links = dir === 'ahead' ? map.outgoing.get(node) ?? [] : inc.get(node) ?? [];
      for (const l of links) {
        for (const v of onLink.get(l.id) ?? []) {
          const d = dist + (dir === 'ahead' ? v.progress : 1 - v.progress) * l.length;
          if (!best || d < best.distance) best = { id: v.id, distance: d };
        }
        const next = dir === 'ahead' ? l.to : l.from;
        const nd = dist + l.length;
        if (nd <= maxDist && (seen.get(next) ?? Infinity) > nd) { seen.set(next, nd); queue.push({ node: next, dist: nd }); }
      }
    }
    return best && best.distance <= maxDist ? best : null;
  }

  return { ahead: search('ahead'), behind: search('behind') };
}
