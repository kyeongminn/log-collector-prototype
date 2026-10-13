import { useMemo, useState } from 'react';
import type { LogLine, LogStream } from './logs/logStream';
import StoragePanel from './StoragePanel';
import { STATUS_COLOR, TREND_CATS, fmtCompact, type TrendCat } from './charts/palette';

const TOTAL_COLOR = '#2a78d6';
import { expectedCounts, syntheticAbnormal } from './charts/trendModel';

type Range = '최근 10분' | '최근 24시간' | '최근 30일';
const RANGES: Range[] = ['최근 10분', '최근 24시간', '최근 30일'];

interface Bucket { start: number; end: number; label: string; cats: Record<TrendCat, number>; err: number; warn: number; real: boolean }

interface Props { stream: LogStream; vehicleCount: number; version: number; lines: LogLine[] }

const pad = (n: number) => String(n).padStart(2, '0');

function buildBuckets(range: Range, stream: LogStream, vehicles: number): Bucket[] {
  const now = Date.now();
  const out: Bucket[] = [];
  const startMinute = Math.floor(stream.startedAt / 60000);
  if (range === '최근 10분') {
    const cur = Math.floor(now / 60000);
    for (let m = cur - 9; m <= cur; m++) {
      const start = m * 60000, end = start + 60000;
      const d = new Date(start);
      const real = m >= startMinute;
      const b = stream.bucket(m);
      const ab = real ? { err: b?.err ?? 0, warn: b?.warn ?? 0 } : syntheticAbnormal(start, end, vehicles);
      out.push({ start, end, label: `${pad(d.getHours())}:${pad(d.getMinutes())}`, cats: expectedCounts(start, end, vehicles), ...ab, real });
    }
  } else if (range === '최근 24시간') {
    const d0 = new Date(now); d0.setMinutes(0, 0, 0);
    for (let h = 23; h >= 0; h--) {
      const start = d0.getTime() - h * 3600000, end = start + 3600000;
      const d = new Date(start);
      let ab = syntheticAbnormal(start, end, vehicles);
      if (end > stream.startedAt) {
        // 현재 시간대는 화면에서 생성된 실제 집계를 더한다
        let err = 0, warn = 0;
        for (let m = Math.max(startMinute, Math.floor(start / 60000)); m < Math.floor(end / 60000); m++) { const b = stream.bucket(m); if (b) { err += b.err; warn += b.warn; } }
        ab = { err: ab.err + err, warn: ab.warn + warn };
      }
      out.push({ start, end, label: `${pad(d.getHours())}시`, cats: expectedCounts(start, end, vehicles), ...ab, real: false });
    }
  } else {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    for (let k = 29; k >= 0; k--) {
      const start = d0.getTime() - k * 86400000, end = start + 86400000;
      const d = new Date(start);
      out.push({ start, end, label: `${d.getMonth() + 1}/${d.getDate()}`, cats: expectedCounts(start, end, vehicles), ...syntheticAbnormal(start, end, vehicles), real: false });
    }
  }
  return out;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** 누적 막대 차트 (SVG). 범주는 고정 순서, 분절 사이 1px 바탕색 간격, 맨 위 분절만 둥근 끝. */
function StackedBars({ buckets, series, colors, height, labelEvery, hover, onHover, unit }: {
  buckets: Bucket[]; series: Array<{ key: string; value: (b: Bucket) => number }>; colors: string[]; height: number; labelEvery: number;
  hover: number | null; onHover: (i: number | null) => void; unit: string;
}) {
  const W = 760, H = height, L = 46, R = 10, T = 18, B = 26;
  const plotW = W - L - R, plotH = H - T - B;
  const totals = buckets.map(b => series.reduce((a, s) => a + s.value(b), 0));
  const yMax = niceMax(Math.max(...totals));
  const n = buckets.length;
  const slot = plotW / n, bw = Math.max(4, slot * 0.62);
  const y = (v: number) => T + plotH - (v / yMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={`${unit} 추이 차트`}>
      {ticks.map(tv => <g key={tv}><line x1={L} x2={W - R} y1={y(tv)} y2={y(tv)} stroke="#edf0f5" strokeWidth="1" /><text x={L - 6} y={y(tv) + 3} textAnchor="end" fontSize="9" fill="#9aa5b5">{fmtCompact(tv)}</text></g>)}
      {buckets.map((b, i) => {
        const x = L + i * slot + (slot - bw) / 2;
        let acc = 0;
        const segs = series.map((s, k) => { const v = s.value(b); const y0 = y(acc + v), y1 = y(acc); acc += v; return { k, v, y0, y1 }; }).filter(s => s.v > 0);
        const top = segs[segs.length - 1];
        return (
          <g key={b.start} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} opacity={hover === null || hover === i ? 1 : 0.55}>
            <rect x={L + i * slot} y={T} width={slot} height={plotH} fill="transparent" />
            {segs.map(s => <rect key={s.k} x={x} y={s.y0 + (s === top ? 0 : 1)} width={bw} height={Math.max(0, s.y1 - s.y0 - (s === top ? 0 : 1))} rx={s === top ? 3 : 0} fill={colors[s.k]} />)}
            {!b.real && <rect x={x} y={T} width={bw} height={plotH} fill="url(#synthetic)" opacity="0.35" pointerEvents="none" />}
            {(n <= 10 || hover === i) && totals[i] > 0 && <text x={x + bw / 2} y={(top ? top.y0 : y(0)) - 5} textAnchor="middle" fontSize="9" fill="#52637b">{fmtCompact(totals[i])}</text>}
            {(i % labelEvery === 0 || i === n - 1) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="#8794a7">{b.label}</text>}
          </g>
        );
      })}
      <defs><pattern id="synthetic" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="2" /></pattern></defs>
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#d9e0ea" strokeWidth="1" />
    </svg>
  );
}

/** 로그 추이 대시보드 (DSH-504). 카테고리별 건수와 이상·주의 건수를 기간별 누적 막대로 보여준다. */
export default function TrendPage({ stream, vehicleCount, version, lines }: Props) {
  const [range, setRange] = useState<Range>('최근 10분');
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  // version 이 바뀔 때(0.5초) 다시 집계한다
  const buckets = useMemo(() => buildBuckets(range, stream, vehicleCount), [range, stream, vehicleCount, version]);
  const labelEvery = range === '최근 10분' ? 1 : range === '최근 24시간' ? 3 : 5;
  const totals = buckets.map(b => TREND_CATS.reduce((a, c) => a + b.cats[c], 0));
  const sumAll = totals.reduce((a, b) => a + b, 0);
  const sumErr = buckets.reduce((a, b) => a + b.err, 0), sumWarn = buckets.reduce((a, b) => a + b.warn, 0);
  const h = hover !== null ? buckets[hover] : null;

  return (
    <div className="trend-page">
      <StoragePanel stream={stream} lines={lines} vehicleCount={vehicleCount} version={version} />
      <section className="panel trend-panel">
        <div className="panel-header">
          <div><h2>로그 추이</h2><span className="panel-sub">전체 로그 건수 · {range} · 차량 {vehicleCount}대</span></div>
          <div className="panel-tools">
            <select aria-label="기간" value={range} onChange={e => setRange(e.target.value as Range)}>{RANGES.map(r => <option key={r}>{r}</option>)}</select>
            <button className="button" onClick={() => setTable(!table)}>{table ? '차트로 보기' : '표로 보기'}</button>
          </div>
        </div>
        <div className="trend-summary">
          <div><span>기간 합계</span><strong>{sumAll.toLocaleString()}</strong><small>줄</small></div>
          <div><span>버킷당 평균</span><strong>{Math.round(sumAll / buckets.length).toLocaleString()}</strong><small>줄</small></div>
          <div className="err"><span>이상</span><strong>{sumErr.toLocaleString()}</strong><small>건</small></div>
          <div className="warn"><span>주의</span><strong>{sumWarn.toLocaleString()}</strong><small>건</small></div>
        </div>
        {table ? (
          <div className="table-scroll"><table className="trend-table">
            <thead><tr><th>구간</th><th>로그 건수</th><th>이상</th><th>주의</th></tr></thead>
            <tbody>{buckets.map((b, i) => <tr key={b.start}><td className="mono">{b.label}</td><td><strong>{totals[i].toLocaleString()}</strong></td><td className={b.err ? 'num-err' : ''}>{b.err}</td><td className={b.warn ? 'num-warn' : ''}>{b.warn}</td></tr>)}</tbody>
          </table></div>
        ) : (
          <div className="trend-chart-wrap">
            <StackedBars buckets={buckets.map(b => ({ ...b, real: true }))} series={[{ key: 'total', value: (b: Bucket) => TREND_CATS.reduce((a, c) => a + b.cats[c], 0) }]} colors={[TOTAL_COLOR]} height={250} labelEvery={labelEvery} hover={hover} onHover={setHover} unit="로그 건수" />
            {h && <div className="trend-tooltip"><strong>{h.label}</strong><span><i style={{ background: TOTAL_COLOR }} />로그 건수 <b>{TREND_CATS.reduce((a, c) => a + h.cats[c], 0).toLocaleString()}</b></span></div>}
          </div>
        )}
        <div className="map-footer"><span>건수는 실제 장비의 시간당 줄 수와 하루 시간대 프로파일로 추정한 값입니다. 운영에서는 사전 집계 테이블이 이 자리를 대신합니다.</span><span>목표 응답 2초 이내</span></div>
      </section>

      <section className="panel trend-panel">
        <div className="panel-header"><div><h2>이상 탐지 추이</h2><span className="panel-sub">본문 규칙 판정 건수 · {range}</span></div></div>
        <div className="trend-chart-wrap">
          <StackedBars buckets={buckets} series={[{ key: 'err', value: b => b.err }, { key: 'warn', value: b => b.warn }]} colors={[STATUS_COLOR.critical, STATUS_COLOR.warning]} height={170} labelEvery={labelEvery} hover={hover} onHover={setHover} unit="이상·주의 건수" />
          {h && <div className="trend-tooltip"><strong>{h.label}</strong><span><i style={{ background: STATUS_COLOR.critical }} />이상 <b>{h.err}</b></span><span><i style={{ background: STATUS_COLOR.warning }} />주의 <b>{h.warn}</b></span></div>}
          <div className="chart-legend"><span><i style={{ background: STATUS_COLOR.critical }} />이상 (ERROR 판정)</span><span><i style={{ background: STATUS_COLOR.warning }} />주의 (WARN 판정)</span></div>
        </div>
        <div className="map-footer"><span>화면이 켜진 뒤의 구간은 생성된 로그의 실제 판정 집계이고, 빗금 구간과 긴 기간은 추정값입니다.</span></div>
      </section>
    </div>
  );
}
