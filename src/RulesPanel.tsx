import { Badge } from './ui';
import { RULES, SEVERITY_LABEL, type LogLine } from './logs/logStream';

interface Props { lines: LogLine[]; disabled: Set<string>; onToggle: (id: string) => void }

/** 이상 모아보기의 탐지 규칙 패널 (ALT-605). 규칙별 적중 건수를 보여주고 규칙을 켜고 끈다. */
export default function RulesPanel({ lines, disabled, onToggle }: Props) {
  const counts: Record<string, number> = {};
  const vehicles: Record<string, Set<string>> = {};
  for (const l of lines) if (l.rule) { counts[l.rule] = (counts[l.rule] ?? 0) + 1; (vehicles[l.rule] ??= new Set()).add(l.vehicle); }
  const active = RULES.length - disabled.size;
  return (
    <section className="panel rules-panel">
      <div className="panel-header"><div><h2>탐지 규칙</h2><span className="panel-sub">원문 레벨이 모두 INFO 이므로 본문 내용으로 판정합니다 · 규칙 {RULES.length}개 중 {active}개 적용</span></div></div>
      <div className="rules-grid">
        {RULES.map(r => {
          const off = disabled.has(r.id);
          return (
            <label key={r.id} className={`rule-card ${off ? 'off' : ''}`}>
              <div className="rule-head"><input type="checkbox" checked={!off} onChange={() => onToggle(r.id)} aria-label={`${r.name} 규칙 적용`} /><strong>{r.name}</strong><Badge text={SEVERITY_LABEL[r.severity]} /></div>
              <p>{r.desc}</p>
              <div className="rule-foot"><span className="category">{r.source}</span><span>{(counts[r.id] ?? 0).toLocaleString()}건 · 차량 {vehicles[r.id]?.size ?? 0}대</span></div>
            </label>
          );
        })}
      </div>
    </section>
  );
}
