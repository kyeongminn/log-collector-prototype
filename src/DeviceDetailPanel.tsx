import { Badge, Icon } from './ui';
import PartIcon from './PartIcon';
import { PART_NAMES, getPartStatus, partLevel, type PartName } from './partStatus';
import { SEVERITY_LABEL, fmtAgo, fmtClock, type LogLine } from './logs/logStream';
import { displayStatus, type FleetVehicle } from './map/useFleet';
import type { RailMap } from './map/railMap';

interface Props {
  vehicle: FleetVehicle;
  map: RailMap;
  lines: LogLine[];
  part: string;
  onPart: (p: string) => void;
  lastSeen?: number;
  counts: { err: number; warn: number };
  onRelatedLogs: (part: string) => void;
}

const LEVEL_CLASS: Record<string, string> = { 정상: 'ok', 경고: 'warn', 오류: 'err' };
/** 부품 상태 색 구분용 클래스. 무수신 차량의 문제 부품은 3D 모델·레일 맵과 같은 보라색으로 */
const levelClass = (level: string, silent: boolean) => (silent && level !== '정상' ? 'silent' : LEVEL_CLASS[level]);

/** 전체 관제 오른쪽의 기기 상세: 기기명·상태, 기기 정보, 부품별 상태, 부품 상세 (3D 모델은 레일 맵 안에서 본다) */
export default function DeviceDetailPanel(p: Props) {
  const v = p.vehicle;
  const zone = v.area === 'MAIN' ? '외곽 레일' : p.map.zones.find(z => z.id === v.area)?.name ?? v.area;
  const selectedPart = PART_NAMES.includes(p.part as PartName) ? (p.part as PartName) : null;
  const detail = selectedPart ? getPartStatus(v, selectedPart) : null;
  const partLog = selectedPart ? p.lines.find(l => l.vehicle === v.id && l.part === selectedPart) : undefined;
  const silent = p.lastSeen === undefined || Date.now() - p.lastSeen > 30000;

  return (
    <div className="device-column">
      <div className="device-head">
        <div><h2>{v.id}</h2><span className="panel-sub">FAB 01 · {zone}</span></div>
        <Badge text={displayStatus(v)} />
      </div>
      <section className="panel device-panel">
        <div className="device-body">
        {/* 부품을 고르면 기기 정보 자리에 부품 상세가 들어간다 */}
        {!detail && <dl className="vehicle-facts">
          <div><dt>위치</dt><dd>{zone}</dd></div>
          <div><dt>속도</dt><dd>{v.driving ? `${(v.vel / 1000).toFixed(1)} m/s` : '정차'}</dd></div>
          <div className={silent ? 'alert' : ''}><dt>최근 수신</dt><dd>{p.lastSeen ? fmtAgo(Date.now() - p.lastSeen) : '수신 없음'}</dd></div>
          <div className="fact-counts"><dt>이상 · 주의</dt><dd><span className={`n-err ${p.counts.err ? 'on' : ''}`}>{p.counts.err}</span><i>·</i><span className={`n-warn ${p.counts.warn ? 'on' : ''}`}>{p.counts.warn}</span></dd></div>
        </dl>}

        {detail && selectedPart ? (
          <div className="component-status part-detail">
            <div className={`cs-head ${levelClass(detail.level, v.status === '무수신')}`}>
              <button className="text-button part-back" onClick={() => p.onPart('')} aria-label="부품 목록으로"><Icon name="chevron" size={12} /></button>
              <PartIcon part={selectedPart} size={26} />
              <div><strong>{selectedPart}</strong><small>{detail.summary}</small></div>
              <span className={`part-level lv-${detail.level}`}>{detail.level}</span>
            </div>
            <dl className="part-metrics">{detail.metrics.map(m => <div key={m.label} className={m.alert ? 'alert' : ''}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
            <div className="part-last-log"><span>최근 로그</span>{partLog ? <p title={partLog.raw}><Badge text={SEVERITY_LABEL[partLog.severity]} /><span className="mono">{fmtClock(partLog.time)}</span><em>{partLog.reason ?? partLog.msg}</em></p> : <p className="no-log">최근 보관 구간에 이 부품 관련 로그가 없습니다.</p>}</div>
            <button onClick={() => p.onRelatedLogs(selectedPart)}>관련 로그 조회 <Icon name="chevron" size={14} /></button>
          </div>
        ) : (
          <div className="part-list">
            <div className="part-list-head"><span>부품 상태</span></div>
            {PART_NAMES.map(name => {
              const level = partLevel(v, name);
              return (
                <button key={name} className={`part-row ${levelClass(level, v.status === '무수신')}`} onClick={() => p.onPart(name)}>
                  <PartIcon part={name} size={20} />
                  <strong>{name}</strong>
                  <small>{getPartStatus(v, name).summary}</small>
                  <span className={`part-level lv-${level}`}>{level}</span>
                </button>
              );
            })}
          </div>
        )}
        </div>
      </section>
    </div>
  );
}
