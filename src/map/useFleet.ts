// 레일 맵 + 차량 위치 상태를 화면에 공급하는 훅.
//
// 지금은 DemoFleet 이 시뮬레이터와 같은 모양의 이벤트를 만들어 넣는다.
// 실제 수집 서버가 생기면 WebSocket 등으로 받은 로그 줄을 parseLine 에 넣고
// 그 결과를 resolver.apply 에 넘기는 부분만 바꾸면 된다.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { buildRailMap, zoneAt, type RailMap } from './railMap';
import { PositionResolver } from './resolver';
import { trafficCaps } from './traffic';
import { DemoFleet, type DemoStatus } from './demoFleet';
import { PART_NAMES, type PartName } from '../partStatus';
import { LogStream, type LogLine } from '../logs/logStream';

export interface FleetVehicle {
  id: string;
  status: DemoStatus;
  /** 이상이 있는 부품(정상 차량은 대표 부품) */
  part: PartName;
  /** 현재 위치한 구역(베이 ID 또는 MAIN) */
  area: string;
  x: number;
  y: number;
  heading: number;
  driving: boolean;
  vel: number;
  /** 레일 맵 위 현재 링크와 그 안의 진행률 (앞·뒤 차량 계산용) */
  linkId: number;
  progress: number;
}

/** 화면에 표시하는 장비 상태. 명세(DSH-505)의 운행·대기·모션 실패·재기동·무수신 구분을 따른다. */
export type VehicleKind = '운행' | '대기' | '모션 실패' | '재기동' | '무선 저하' | '무수신';

/** 데모에서 이상 상태로 둘 차량. 로그 스트림이 같은 차량에 해당 이상 로그를 만든다. */
export const DEMO_FAULTS: Record<string, { status: DemoStatus; part: PartName; kind: VehicleKind }> = {
  'OHT-0024': { status: '오류', part: '주행부', kind: '모션 실패' },
  'OHT-0028': { status: '오류', part: '제어부', kind: '재기동' },
  'OHT-0017': { status: '경고', part: '통신 모듈', kind: '무선 저하' },
  'OHT-0013': { status: '무수신', part: '제어부', kind: '무수신' },
};

export function displayStatus(v: { id: string; status: DemoStatus }): VehicleKind {
  return DEMO_FAULTS[v.id]?.kind ?? (v.status === '운행' || v.status === '대기' ? v.status : '무수신');
}

const TICK_MS = 100;
/** 화면(목록·상단 지표 등)을 다시 그리는 간격. 3D 맵은 live 로 매 틱 위치를 받으므로 화면 전체를 0.1초마다 다시 그리지 않는다 */
const UI_MS = 500;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function useFleet(count = 30): { map: RailMap; vehicles: FleetVehicle[]; live: RefObject<FleetVehicle[]>; logStream: LogStream } {
  const map = useMemo(() => buildRailMap(), []);
  const [logStream] = useState(() => new LogStream());
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  /** 매 틱(0.1초) 갱신되는 최신 차량 상태. 3D 맵이 프레임마다 읽는다 */
  const live = useRef<FleetVehicle[]>([]);
  const engine = useRef<{ fleet: DemoFleet; resolver: PositionResolver; last: number } | null>(null);

  useEffect(() => {
    const t0 = Date.now();
    const faults = Object.fromEntries(Object.entries(DEMO_FAULTS).map(([k, v]) => [k, v.status]));
    const fleet = new DemoFleet({ count, seed: 7, faults }, t0);
    // 오류·무수신 차량은 멈춰 있으므로 F 베이(스토커)에 두고, 다른 차량은 그 베이로 들어가지 않는다(멈춘 차량 뒤에 줄줄이 막히지 않게)
    const parked = Object.entries(DEMO_FAULTS).filter(([, f]) => f.status === '오류' || f.status === '무수신').map(([id]) => id);
    const resolver = new PositionResolver(map, { parked, closedZone: 'BAY-F' });
    engine.current = { fleet, resolver, last: t0 };
    const order = new Map<string, string>();   // 합류 등에서 정한 통과 순서 (틱 사이 유지)

    const parts = Object.fromEntries(fleet.vehicles.map(v => [v.id, DEMO_FAULTS[v.id]?.part ?? PART_NAMES[hash(v.id) % PART_NAMES.length]]));

    const tick = () => {
      const e = engine.current!;
      const now = Date.now();
      for (const [id, ev] of e.fleet.step(now, now - e.last)) { e.resolver.apply(id, ev); logStream.apply(id, ev); }
      logStream.tick(now, e.fleet.vehicles.map(v => ({ id: v.id, status: e.fleet.status(v), driving: v.driving })));
      e.last = now;
      const pos = new Map(e.fleet.vehicles.map(v => [v.id, e.resolver.position(v.id, now, v.v)]));
      // 서로 통과하지 못하게: 맵 위 간격으로 다음 틱의 속도 상한을 정한다
      e.fleet.setCaps(trafficCaps(map, [...pos].map(([id, p]) => ({ id, linkId: p.linkId, progress: p.progress, driving: p.driving, vel: p.vel })), (id, linkId) => e.resolver.pathAhead(id, linkId), (id, linkId) => e.resolver.scaleAt(id, linkId), order));
      live.current = e.fleet.vehicles.map(v => {
        const p = pos.get(v.id)!;
        return { id: v.id, status: e.fleet.status(v), part: parts[v.id], area: zoneAt(map, p.x, p.y), x: p.x, y: p.y, heading: p.heading, driving: p.driving, vel: p.vel, linkId: p.linkId, progress: p.progress };
      });
      if (now - lastUi >= UI_MS) { lastUi = now; setVehicles(live.current); }
    };
    let lastUi = 0;
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [map, count, logStream]);

  return { map, vehicles, live, logStream };
}

/**
 * 로그 스트림의 최신 줄 배열. 따로 타이머를 두지 않고 화면이 다시 그려질 때(차량 상태 갱신, 0.5초마다) 함께 읽어
 * 다시 그리는 횟수를 줄인다. 일시정지 중에는 멈춘 시점의 줄을 유지한다.
 */
export function useLogLines(stream: LogStream, paused: boolean): LogLine[] {
  const frozen = useRef<LogLine[] | null>(null);
  if (paused) return (frozen.current ??= stream.snapshot());
  frozen.current = null;
  return stream.snapshot();
}
