// 레일 맵 + 차량 위치 상태를 화면에 공급하는 훅.
//
// 지금은 DemoFleet 이 시뮬레이터와 같은 모양의 이벤트를 만들어 넣는다.
// 실제 수집 서버가 생기면 WebSocket 등으로 받은 로그 줄을 parseLine 에 넣고
// 그 결과를 resolver.apply 에 넘기는 부분만 바꾸면 된다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildRailMap, zoneAt, type RailMap } from './railMap';
import { PositionResolver } from './resolver';
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

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function useFleet(count = 30): { map: RailMap; vehicles: FleetVehicle[]; logStream: LogStream } {
  const map = useMemo(() => buildRailMap(), []);
  const [logStream] = useState(() => new LogStream());
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const engine = useRef<{ fleet: DemoFleet; resolver: PositionResolver; last: number } | null>(null);

  useEffect(() => {
    const t0 = Date.now();
    const faults = Object.fromEntries(Object.entries(DEMO_FAULTS).map(([k, v]) => [k, v.status]));
    const fleet = new DemoFleet({ count, seed: 7, faults }, t0);
    const resolver = new PositionResolver(map);
    engine.current = { fleet, resolver, last: t0 };

    const parts = Object.fromEntries(fleet.vehicles.map(v => [v.id, DEMO_FAULTS[v.id]?.part ?? PART_NAMES[hash(v.id) % PART_NAMES.length]]));

    const tick = () => {
      const e = engine.current!;
      const now = Date.now();
      for (const [id, ev] of e.fleet.step(now, now - e.last)) { e.resolver.apply(id, ev); logStream.apply(id, ev); }
      logStream.tick(now, e.fleet.vehicles.map(v => ({ id: v.id, status: e.fleet.status(v), driving: v.driving })));
      e.last = now;
      setVehicles(e.fleet.vehicles.map(v => {
        const p = e.resolver.position(v.id, now);
        return { id: v.id, status: e.fleet.status(v), part: parts[v.id], area: zoneAt(map, p.x, p.y), x: p.x, y: p.y, heading: p.heading, driving: p.driving, vel: p.vel, linkId: p.linkId, progress: p.progress };
      }));
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [map, count, logStream]);

  return { map, vehicles, logStream };
}

/** 로그 스트림의 최신 줄 배열. 0.5초마다 갱신하고, 일시정지 중에는 마지막 화면을 유지한다. */
export function useLogLines(stream: LogStream, paused: boolean): LogLine[] {
  const [lines, setLines] = useState<LogLine[]>(() => stream.snapshot());
  useEffect(() => {
    if (paused) return;
    const update = () => setLines(stream.snapshot());
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [stream, paused]);
  return lines;
}
