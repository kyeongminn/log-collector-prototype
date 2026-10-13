import { Badge, Icon } from './ui';
import { SEVERITY_LABEL, fmtClock, fmtDate, type LogLine } from './logs/logStream';

interface Props { line: LogLine; lines: LogLine[]; onClose: () => void }

/** 로그 한 줄의 원문과 파싱 결과, 같은 차량의 최근 이벤트를 보여준다. */
export default function LogDetailModal({ line, lines, onClose }: Props) {
  const timeline = lines.filter(l => l.vehicle === line.vehicle && l.cat !== 'NET' && l.time <= line.time).slice(0, 8);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="log-modal" onClick={e => e.stopPropagation()}>
        <div className="panel-header"><h2>로그 상세 · 원문</h2><button className="icon-button" onClick={onClose} aria-label="닫기">×</button></div>
        <div className="modal-body">
          <div className="modal-meta"><Badge text={SEVERITY_LABEL[line.severity]} /><strong>{line.vehicle}</strong><span>{line.logger} · {line.cat} · {line.level}</span></div>
          <h3>{line.reason ?? line.msg.slice(0, 60)}</h3>
          <p>{fmtDate(line.time)} KST · 관련 부품(추정) {line.part}</p>
          <dl className="detail-grid">
            <div><dt>파일</dt><dd>{line.file}</dd></div>
            <div><dt>{line.logger === 'OHTHandlerLogger' ? '순번' : '스레드'}</dt><dd>{line.logger === 'OHTHandlerLogger' ? line.seq : line.thread}</dd></div>
            <div><dt>원문 레벨</dt><dd>{line.level}</dd></div>
            <div><dt>판정</dt><dd>{SEVERITY_LABEL[line.severity]}{line.reason ? ` · ${line.reason}` : ''}</dd></div>
          </dl>
          <div className="raw-label">RAW LINE <span>파일에 기록되는 줄 그대로 · CRLF 제외</span></div>
          <pre className="raw-line">{line.raw}</pre>
          <h3>차량 이벤트 타임라인</h3>
          <div className="timeline">{timeline.map(l => (
            <div key={l.id}>
              <span className={`dot ${l.severity === 'ERROR' ? 'red' : l.severity === 'WARN' ? 'amber' : 'blue'}`} />
              <span className="mono">{fmtClock(l.time)}</span>
              <span className="category">{l.cat}</span>
              <em title={l.raw}>{l.msg}</em>
            </div>
          ))}</div>
        </div>
        <div className="modal-footer"><button className="button" onClick={onClose}>닫기 <Icon name="chevron" size={13} /></button></div>
      </section>
    </div>
  );
}
