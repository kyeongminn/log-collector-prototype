import { Badge } from './ui';
import { fmtAgo } from './logs/logStream';
import { displayStatus, type FleetVehicle } from './map/useFleet';
import type { RailMap } from './map/railMap';
import type { DemoStatus } from './map/demoFleet';

const SILENT_AFTER_MS = 30000;
const STATUS_FILL: Record<string, string> = { 오류: '#cd5b5b', 경고: '#d69b3b', 대기: '#94a3b8', 운행: '#53877d', 무수신: '#8e7cc3' };
const ORDER: Record<string, number> = { 오류: 0, 무수신: 1, 경고: 2, 운행: 3, 대기: 4 };
const STATUSES: DemoStatus[] = ['운행', '대기', '경고', '오류', '무수신'];

/** 목록 필터: '전체', 상태 하나, 또는 '이상'(오류·경고·무수신) */
export type ListFilter = '전체' | DemoStatus | '이상';
export const ABNORMAL: DemoStatus[] = ['오류', '경고', '무수신'];
export function matchesFilter(status: DemoStatus, filter: ListFilter) {
  return filter === '전체' || (filter === '이상' ? ABNORMAL.includes(status) : status === filter);
}

interface Props {
  vehicles: FleetVehicle[];
  map: RailMap;
  lastSeen: (id: string) => number | undefined;
  selectedId: string | null;
  onSelect: (v: FleetVehicle) => void;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
}

/** 레일 맵 위의 차량 모양을 그대로 쓴 작은 아이콘 */
function MiniOht({ status }: { status: string }) {
  return (
    <svg className="mini-oht" width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
      <rect x="1" y="1" width="20" height="12" rx="3" fill={STATUS_FILL[status]} stroke="#fff" strokeWidth="1.5" />
      <rect x="6" y="4" width="10" height="6" rx="1.2" fill="#fff" opacity=".7" />
    </svg>
  );
}

/** 전체 관제 우측의 실시간 기기 목록. 상태별로 걸러 보고, 행을 누르면 그 기기로 전환한다. */
export default function VehicleListPanel({ vehicles, map, lastSeen, selectedId, onSelect, filter, onFilter }: Props) {
  const setFilter = onFilter;
  const now = Date.now();
  const rows = vehicles.map(v => {
    const seen = lastSeen(v.id);
    const silent = v.status !== '무수신' && seen !== undefined && now - seen > SILENT_AFTER_MS;
    const status: DemoStatus = silent ? '무수신' : v.status;
    return { v, status, seen, silent };
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const shown = rows.filter(r => matchesFilter(r.status, filter)).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.v.id.localeCompare(b.v.id));
  const abnormal = rows.filter(r => ABNORMAL.includes(r.status)).length;
  const zoneName = (id: string) => (id === 'MAIN' ? '외곽 레일' : map.zones.find(z => z.id === id)?.name ?? id);

  return (
    <section className="panel vehicle-list-panel">
      <div className="panel-header"><div><h2>기기 상태 <span className="live-tag">LIVE</span></h2><span className="panel-sub">{vehicles.length}대 · 이상 {(counts.오류 ?? 0) + (counts.경고 ?? 0) + (counts.무수신 ?? 0)}대</span></div></div>
      <div className="status-chips">
        <button className={filter === '전체' ? 'active' : ''} onClick={() => setFilter('전체')}>전체 {vehicles.length}</button>
        {STATUSES.map(s => <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(filter === s ? '전체' : s)}><span className="dot" style={{ background: STATUS_FILL[s] }} />{s} {counts[s] ?? 0}</button>)}
        <button className={filter === '이상' ? 'active' : ''} onClick={() => setFilter(filter === '이상' ? '전체' : '이상')}>이상 {abnormal}</button>
      </div>
      <div className="vehicle-list" role="list">
        {shown.map(r => (
          <button key={r.v.id} role="listitem" className={`vehicle-row ${r.v.id === selectedId ? 'selected' : ''} ${r.status === '무수신' ? 'silent' : ''}`} onClick={() => onSelect(r.v)} title={`${r.v.id} · ${zoneName(r.v.area)}`}>
            <MiniOht status={r.status} />
            <strong>{r.v.id}</strong>
            <Badge text={r.status === '무수신' ? '무수신' : displayStatus(r.v)} />
            <span className="vehicle-row-sub">{zoneName(r.v.area)} · {r.v.driving && r.status !== '무수신' ? `${(r.v.vel / 1000).toFixed(1)} m/s` : '정차'}</span>
            <small>{r.seen ? fmtAgo(now - r.seen) : '수신 없음'}</small>
          </button>
        ))}
        {!shown.length && <div className="empty">해당 상태의 기기가 없습니다.</div>}
      </div>
      <div className="map-footer"><span>행을 누르면 좌측에 3D 차량, 우측에 기기 정보가 표시됩니다.</span></div>
    </section>
  );
}
