import { useMemo } from 'react';
import { COMPRESSION_RATIO, HOT_RETENTION_DAYS, fmtDate, type LogLine, type LogStream } from './logs/logStream';
import { expectedByCategory } from './charts/trendModel';
import { Icon } from './ui';

interface Props { stream: LogStream; lines: LogLine[]; vehicleCount: number; version: number }

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const fmtDayTime = (ms: number) => { const d = new Date(ms); return `${fmtDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function fmtBytes(b: number) {
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

/** 조회 가능한 로그 범위와 쌓인 로그의 양 (DSH-504 보조, STO-405·407 기준치 표시) */
export default function StoragePanel({ stream, lines, vehicleCount, version }: Props) {
  const now = Date.now();
  const data = useMemo(() => {
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const rangeStart = todayStart.getTime() - (HOT_RETENTION_DAYS - 1) * 86400000;
    const hot = expectedByCategory(rangeStart, now, vehicleCount);
    const today = expectedByCategory(todayStart.getTime(), now, vehicleCount);
    const sum = (r: Record<string, { lines: number; bytes: number }>) => Object.values(r).reduce((a, v) => ({ lines: a.lines + v.lines, bytes: a.bytes + v.bytes }), { lines: 0, bytes: 0 });
    const hotSum = sum(hot), todaySum = sum(today);
    const days = (now - rangeStart) / 86400000;
    // 화면 보관 (실제 생성된 줄)
    let bytes = 0, oldest = Infinity, newest = 0;
    for (const l of lines) { bytes += l.raw.length + 2; if (l.time < oldest) oldest = l.time; if (l.time > newest) newest = l.time; }
    return { rangeStart, hotSum, todaySum, days, buffer: { lines: lines.length, bytes, oldest: isFinite(oldest) ? oldest : undefined, newest: newest || undefined } };
    // version 이 바뀔 때마다 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleCount, version, lines]);

  const { rangeStart, hotSum, todaySum, days, buffer } = data;

  return (
    <section className="panel storage-panel">
      <div className="panel-header"><div><h2>조회 가능 범위와 보관량</h2><span className="panel-sub">Hot 보관 {HOT_RETENTION_DAYS}일 · 차량 {vehicleCount}대 · 운영에서는 저장소 집계로 대체</span></div></div>
      <div className="storage-cards">
        <div className="storage-card range">
          <span>조회 가능한 로그 범위</span>
          <strong>{fmtDay(rangeStart)} <em>~</em> {fmtDayTime(now)}</strong>
          <small>{Math.floor(days)}일 {Math.round((days % 1) * 24)}시간 · 가장 오래된 날은 매일 자정에 Cold 로 넘어갑니다 (삭제까지의 기간은 기업 확정 대기)</small>
        </div>
        <div className="storage-card"><span>쌓인 로그 (원본)</span><strong>{fmtBytes(hotSum.bytes)}</strong><small>{hotSum.lines.toLocaleString()}줄 · 하루 평균 {fmtBytes(hotSum.bytes / days)}</small></div>
        <div className="storage-card"><span>저장소 예상 크기</span><strong>{fmtBytes(hotSum.bytes / COMPRESSION_RATIO.max)} ~ {fmtBytes(hotSum.bytes / COMPRESSION_RATIO.min)}</strong><small>압축비 {COMPRESSION_RATIO.min}~{COMPRESSION_RATIO.max}배 기준 (실측 후 확정)</small></div>
        <div className="storage-card"><span>오늘 누적</span><strong>{fmtBytes(todaySum.bytes)}</strong><small>{todaySum.lines.toLocaleString()}줄 · 00:00 부터</small></div>
        <div className="storage-card live"><span>화면 보관 (실제 생성)</span><strong>{buffer.lines.toLocaleString()}줄 · {fmtBytes(buffer.bytes)}</strong><small>{buffer.oldest && buffer.newest ? `${fmtDate(buffer.oldest).slice(11)} ~ ${fmtDate(buffer.newest).slice(11)} · 최근 ${stream.max.toLocaleString()}줄만 유지` : '수집 대기'}</small></div>
      </div>
      <div className="map-footer"><span><Icon name="logs" size={14} /> 양은 실제 장비의 시간당 줄 수·평균 줄 길이와 하루 시간대 프로파일로 추정한 값입니다. 화면 보관 카드만 실제 생성된 로그입니다.</span></div>
    </section>
  );
}
