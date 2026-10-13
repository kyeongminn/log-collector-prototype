import { useEffect, useState } from 'react';
import { Badge, Icon } from './ui';
import { CATEGORIES, SEVERITY_LABEL, SEVERITY_OPTIONS, fmtClock, type LogLine } from './logs/logStream';
import { UI } from './logs/messages';

export interface TimeRange { preset: string; from: string; to: string }
export const RANGE_PRESETS = ['전체 보관', '최근 10초', '최근 30초', '최근 1분', '날짜·시각 지정'];

/** 시간 범위 설정을 epoch ms 경계로 바꾼다. 날짜·시각 지정은 YYYY-MM-DDTHH:MM:SS(로컬 시각)로 해석한다. */
export function rangeBounds(r: TimeRange, now: number): { from?: number; to?: number } {
  const secs: Record<string, number> = { '최근 10초': 10, '최근 30초': 30, '최근 1분': 60 };
  if (secs[r.preset]) return { from: now - secs[r.preset] * 1000 };
  if (r.preset === '날짜·시각 지정') {
    const parse = (s: string) => { if (!s) return undefined; const t = new Date(s).getTime(); return Number.isNaN(t) ? undefined : t; };
    const to = parse(r.to);
    // 종료 시각에 초가 없으면 그 분의 끝까지 포함한다
    return { from: parse(r.from), to: to !== undefined && r.to.length <= 16 ? to + 59999 : to };
  }
  return {};
}

interface Props {
  lines: LogLine[];          // 전체 보관 줄 (최신 먼저)
  timeRange: TimeRange; setTimeRange: (r: TimeRange) => void;
  filtered: LogLine[];       // 필터 적용 결과
  vehicleIds: string[];
  selectedId: string;
  overview: boolean;
  page: string;
  tab: string; setTab: (t: string) => void;
  setPage: (p: string) => void;
  device: string; setDevice: (v: string) => void;
  level: string; setLevel: (v: string) => void;
  category: string; setCategory: (v: string) => void;
  component: string; setComponent: (v: string) => void;
  search: string; setSearch: (v: string) => void;
  warning: boolean; setWarning: (v: boolean) => void;
  paused: boolean;
  onDetail: (l: LogLine) => void;
}

export default function LogsPanel(p: Props) {
  const pageSize = p.overview ? 5 : 10;
  const [pageIdx, setPageIdx] = useState(0);
  const pages = Math.max(1, Math.ceil(p.filtered.length / pageSize));
  useEffect(() => { if (pageIdx >= pages) setPageIdx(pages - 1); }, [pages, pageIdx]);
  const rows = p.filtered.slice(pageIdx * pageSize, pageIdx * pageSize + pageSize);
  const reset = () => { p.setSearch(''); p.setComponent(''); p.setDevice('전체 차량'); p.setLevel('전체 판정'); p.setCategory('전체 카테고리'); p.setTimeRange({ preset: '전체 보관', from: '', to: '' }); setPageIdx(0); };
  const tabs = p.overview ? (p.selectedId ? ['전체 로그', '선택 차량 로그'] : ['전체 로그']) : [p.search.trim() ? '검색 결과' : p.page];
  const tabCount = (t: string) => (t === '선택 차량 로그' ? p.lines.filter(l => l.vehicle === p.selectedId).length : t === '전체 로그' ? p.lines.length : p.filtered.length);
  const now = p.lines[0]?.time ?? Date.now();
  const hour = new Date(now);

  return (
    <section className="panel logs-panel">
      <div className="panel-header">
        <div className="log-tabs">{tabs.map(t => <button key={t} className={p.tab === t || !p.overview ? 'active' : ''} onClick={() => { p.setTab(t); setPageIdx(0); }}>{t}<span>{tabCount(t).toLocaleString()}</span></button>)}</div>
        <div className="log-header-right"><span className={`dot ${p.paused ? 'gray' : 'green'}`} />{p.paused ? '업데이트 일시정지' : '최신 로그 기준 · 0.5초 갱신'}<button className="text-button" onClick={() => { p.setPage('로그 조회'); p.setTab('전체 로그'); }}>전체 로그 보기 <Icon name="chevron" size={13} /></button></div>
      </div>
      <div className="filter-bar">
        <select aria-label="차량 필터" value={p.device} onChange={e => { p.setDevice(e.target.value); setPageIdx(0); }}><option>전체 차량</option>{p.vehicleIds.map(id => <option key={id}>{id}</option>)}</select>
        <select aria-label="카테고리 필터" value={p.category} onChange={e => { p.setCategory(e.target.value); setPageIdx(0); }}><option>전체 카테고리</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <select aria-label="판정 필터" value={p.level} onChange={e => { p.setLevel(e.target.value); setPageIdx(0); }}>{SEVERITY_OPTIONS.map(l => <option key={l}>{l}</option>)}</select>
        {p.component && <button className="button" onClick={() => p.setComponent('')}>{p.component} ×</button>}
        <select aria-label="시간 범위" value={p.timeRange.preset} onChange={e => { p.setTimeRange({ ...p.timeRange, preset: e.target.value }); setPageIdx(0); }}>{RANGE_PRESETS.map(r => <option key={r}>{r}</option>)}</select>
        {p.timeRange.preset === '날짜·시각 지정' && <span className="time-inputs"><input type="datetime-local" step="1" aria-label="시작 일시" value={p.timeRange.from} onChange={e => { p.setTimeRange({ ...p.timeRange, from: e.target.value }); setPageIdx(0); }} /><span>—</span><input type="datetime-local" step="1" aria-label="종료 일시" value={p.timeRange.to} onChange={e => { p.setTimeRange({ ...p.timeRange, to: e.target.value }); setPageIdx(0); }} /><button type="button" className="text-button" onClick={() => { const d = new Date(); const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:${String(x.getSeconds()).padStart(2, '0')}`; const s = new Date(d.getTime() - 30000); p.setTimeRange({ ...p.timeRange, from: f(s), to: f(d) }); setPageIdx(0); }}>지금 기준 30초</button></span>}
        <span className="period">{hour.getFullYear()}.{String(hour.getMonth() + 1).padStart(2, '0')}.{String(hour.getDate()).padStart(2, '0')} <span>{String(hour.getHours()).padStart(2, '0')}시 파일</span></span>
        <div className="inline-search"><Icon name="search" size={15} /><input aria-label="로그 필터 검색" placeholder="원문 검색 (메시지, 노드, MAC …)" value={p.search} onChange={e => { p.setSearch(e.target.value); setPageIdx(0); }} /></div>
        {p.page === '이상 모아보기' && <label className="warning-check"><input type="checkbox" checked={p.warning} onChange={e => p.setWarning(e.target.checked)} />주의 포함</label>}
        <button className="icon-button" aria-label="필터 초기화" onClick={reset}><Icon name="refresh" size={15} /></button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>발생 시각 <span>↓</span></th><th>차량</th><th>카테고리</th><th>레벨</th><th>판정</th><th>메시지</th><th /></tr></thead>
          <tbody>{rows.map(l => (
            <tr key={l.id} onClick={() => p.onDetail(l)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && p.onDetail(l)} className={l.severity === 'ERROR' ? 'error-row' : l.severity === 'WARN' ? 'warn-row' : ''}>
              <td className="mono">{fmtClock(l.time)}</td>
              <td className="vehicle-cell">{l.vehicle}</td>
              <td><div className="cat-cell"><span className="category">{l.cat}</span><small>{l.logger}</small></div></td>
              <td className="level-cell">{l.level}</td>
              <td><Badge text={SEVERITY_LABEL[l.severity]} /></td>
              <td className="message-cell" title={l.raw}>{l.msg}{l.reason && <small>{l.reason}</small>}</td>
              <td><Icon name="chevron" size={14} /></td>
            </tr>
          ))}</tbody>
        </table>
        {!p.filtered.length && <div className="empty">{p.lines.length ? '검색 조건에 맞는 로그가 없습니다.' : '로그를 기다리는 중입니다.'}<button className="text-button" onClick={reset}>필터 초기화</button></div>}
      </div>
      <div className="table-footer">
        <span>총 {p.filtered.length.toLocaleString()}건 <span>· 최근 {p.lines.length.toLocaleString()}줄 보관 · {UI.omittedNote}</span></span>
        <div>
          <span>페이지당 {pageSize}건</span>
          <div className="pager">
            <button className="pagination" aria-label="이전 페이지" disabled={pageIdx === 0} onClick={() => setPageIdx(i => Math.max(0, i - 1))}>‹</button>
            <span>{pageIdx + 1} / {pages}</span>
            <button className="pagination" aria-label="다음 페이지" disabled={pageIdx >= pages - 1} onClick={() => setPageIdx(i => Math.min(pages - 1, i + 1))}>›</button>
          </div>
        </div>
      </div>
    </section>
  );
}
