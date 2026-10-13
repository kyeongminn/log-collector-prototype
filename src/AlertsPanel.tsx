import { Badge, Icon } from './ui';
import { SEVERITY_LABEL, effectiveSeverity, fmtClock, type LogLine } from './logs/logStream';

interface Props {
  alerts: LogLine[];               // 확인하지 않은 이상·주의 줄, 최신 먼저
  disabled: Set<string>;
  onAck: (id: number) => void;
  onAckAll: () => void;
  onGoto: () => void;
  onOpen: (l: LogLine) => void;
}

/** 알림 패널 (ALT-603). 탐지 결과를 실시간으로 보여주고 확인 처리한다. 운영에서는 SSE 로 받는다. */
export default function AlertsPanel({ alerts, disabled, onAck, onAckAll, onGoto, onOpen }: Props) {
  return (
    <div className="notification-panel alerts-panel">
      <div className="alerts-head"><strong>알림 {alerts.length ? `(${alerts.length})` : ''}</strong>{alerts.length > 0 && <button className="text-button" onClick={onAckAll}>모두 확인</button>}</div>
      {alerts.length === 0 && <p className="alerts-empty">확인할 알림이 없습니다.</p>}
      <ul>
        {alerts.slice(0, 8).map(l => (
          <li key={l.id}>
            <Badge text={SEVERITY_LABEL[effectiveSeverity(l, disabled)]} />
            <div className="alert-body" onClick={() => onOpen(l)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(l)}>
              <strong>{l.vehicle}</strong> <span>{l.reason ?? l.msg.slice(0, 50)}</span>
              <small>{fmtClock(l.time)} · {l.cat}</small>
            </div>
            <button className="icon-button" aria-label="알림 확인" onClick={() => onAck(l.id)}>✓</button>
          </li>
        ))}
      </ul>
      {alerts.length > 8 && <p className="alerts-more">외 {alerts.length - 8}건</p>}
      <button className="alerts-goto" onClick={onGoto}>이상 모아보기로 이동 <Icon name="chevron" size={14} /></button>
    </div>
  );
}
