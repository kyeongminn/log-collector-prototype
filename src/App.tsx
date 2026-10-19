import { lazy, Suspense, useMemo, useState } from 'react';
import { Icon } from './ui';
import LogsPanel from './LogsPanel';
import LogDetailModal from './LogDetailModal';
import TrendPage from './TrendPage';
import RulesPanel from './RulesPanel';
import VehicleListPanel, { type ListFilter } from './VehicleListPanel';
import DeviceDetailPanel from './DeviceDetailPanel';
import { railNeighbors } from './map/neighbors';
import AlertsPanel from './AlertsPanel';
import { rangeBounds, type TimeRange } from './LogsPanel';
import { filterLogs, effectiveSeverity, type LogLine } from './logs/logStream';
import { focusRect } from './map/railMap';
const RailMap3D = lazy(() => import('./RailMap3D'));
import { useFleet, useLogLines, displayStatus, type FleetVehicle } from './map/useFleet';
import { UI } from './logs/messages';

const FALLBACK_VEHICLE: FleetVehicle = { id: 'OHT-0024', status: '오류', part: '주행부', area: 'MAIN', x: 0, y: 0, heading: 0, driving: false, vel: 0, linkId: 0, progress: 0 };
const nav = [
  { title: '전체 관제', icon: 'grid' }, { title: '로그 조회', icon: 'logs' }, { title: '로그 추이', icon: 'expand' }, { title: '이상 모아보기', icon: 'alert' },
] as const;

export default function App() {
  const [page, setPage] = useState('전체 관제');
  const { map, vehicles, live, logStream } = useFleet(30);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<ListFilter>('전체');
  // 앞·뒤 차량 이동 시 3D 뷰 스와이프 효과 (n 이 바뀔 때마다 애니메이션 재생)
  function goNeighbor(dir: 'prev' | 'next') { const id = dir === 'prev' ? neighbors.ahead?.id : neighbors.behind?.id; /* 왼쪽 화살표 = 앞 차량, 오른쪽 = 뒤 차량 */ const v = vehicles.find(x => x.id === id); if (!v) return; chooseVehicle(v); }
  /** 상단바 항목 클릭: 해당 필터가 적용된 전체 관제로 이동 */
  function goOverview(filter: ListFilter, scrollTo?: string) {
    setPage('전체 관제'); setSelectedId(null); setListFilter(filter);
    if (scrollTo) setTimeout(() => document.querySelector(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const selected = vehicles.find(v => v.id === selectedId) ?? vehicles[0] ?? FALLBACK_VEHICLE;
  const counts = { 운행: 0, 대기: 0, 경고: 0, 오류: 0, 무수신: 0 } as Record<string, number>;
  for (const v of vehicles) counts[v.status]++;
  const [part, setPart] = useState('주행부');
  const [tab, setTab] = useState('전체 로그');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('전체 판정');
  const [category, setCategory] = useState('전체 카테고리');
  const [device, setDevice] = useState('전체 차량');
  const [component, setComponent] = useState('');
  const [warning, setWarning] = useState(false);
  const [detail, setDetail] = useState<LogLine | null>(null);
  // 레일 맵: 바로 위에서 보기, 차량 상세에서 시점 고정
  const [topView, setTopView] = useState(false);
  // 기기 상세(차량 따라가기): 자동 회전 여부, 앞 시점으로 되돌리기(누를 때마다 값 증가)
  const [autoRotate, setAutoRotate] = useState(false);
  const [viewReset, setViewReset] = useState(0);
  const [area, setArea] = useState('ALL');
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState(false);
  const lines = useLogLines(logStream, paused);
  const [timeRange, setTimeRange] = useState<TimeRange>({ preset: '전체 보관', from: '', to: '' });
  const [disabledRules, setDisabledRules] = useState<Set<string>>(() => new Set());
  const [acked, setAcked] = useState<Set<number>>(() => new Set());
  const toggleRule = (id: string) => setDisabledRules(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // 알림: 확인하지 않은 이상·주의 줄 (ALT-603)
  const alerts = useMemo(() => lines.filter(l => effectiveSeverity(l, disabledRules) !== 'INFO' && !acked.has(l.id)).slice(0, 100), [lines, disabledRules, acked]);
  const alertVehicles = useMemo(() => new Set(lines.filter(l => effectiveSeverity(l, disabledRules) === 'ERROR').map(l => l.vehicle)).size, [lines, disabledRules]);
  // 로그 줄이나 필터가 바뀔 때만 다시 거른다(차량 위치는 0.1초마다 바뀌어 화면 전체가 다시 그려지므로)
  const filtered = useMemo(() => filterLogs(lines, { part: component, errorsOnly: page === '이상 모아보기', includeWarn: warning, severity: level, category, vehicle: device, onlyVehicle: tab === '선택 차량 로그' ? selected.id : '', search, ...rangeBounds(timeRange, Date.now()), disabledRules }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, component, page, warning, level, category, device, tab, selected.id, search, timeRange, disabledRules]);
  const vehicleIdsKey = vehicles.map(v => v.id).join(",");
  const vehicleIds = useMemo(() => (vehicleIdsKey ? vehicleIdsKey.split(",") : []), [vehicleIdsKey]);
  function chooseVehicle(v: FleetVehicle) { setSelectedId(v.id); setPart(''); }
  function clearSelection() { setSelectedId(null); setAutoRotate(false); if (tab === '선택 차량 로그') setTab('전체 로그'); }
  const focus = selectedId !== null && vehicles.some(v => v.id === selectedId);
  // 전체 보기에서 확대할 영역(고른 구역). 기기 상세에서는 카메라가 차량을 따라가므로 쓰지 않는다.
  const mapFocus = useMemo(() => focusRect(map, area, null), [map, area]);
  const focusZoneName = focus ? (selected.area === 'MAIN' ? '외곽 레일' : map.zones.find(z => z.id === selected.area)?.name ?? selected.area) : '';
  const selectedSeen = focus ? logStream.lastSeen(selected.id) : undefined;
  // 위치 로그 기준 앞·뒤 차량 (레일을 따라 250 m 이내)
  const neighbors = useMemo(() => (focus ? railNeighbors(map, vehicles, selected.id) : { ahead: null, behind: null }), [focus, map, vehicles, selected.id]);
  const selectedCounts = useMemo(() => { let err = 0, warn = 0; for (const l of lines) if (l.vehicle === selected.id) { const sv = effectiveSeverity(l, disabledRules); if (sv === 'ERROR') err++; else if (sv === 'WARN') warn++; } return { err, warn }; }, [lines, selected.id, disabledRules]);
  const overview = page === '전체 관제';
  return <div className="app">
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => goOverview("전체")} title="전체 관제로 이동"><img className="brand-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="Log Collector" /><img className="brand-logo-mark" src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="Log Collector" /></button>
      <div className="workspace"><span className="workspace-icon">F</span><div>FAB 01<small>반도체 생산 라인</small></div><span className="down">⌄</span></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{nav.map(n => <button key={n.title} className={`nav-item ${page === n.title ? 'active' : ''}`} onClick={() => { setPage(n.title); setComponent(''); setSearch(''); setQuery(''); setTab('전체 로그'); setDevice('전체 차량'); setLevel('전체 판정'); setCategory('전체 카테고리'); }}><Icon name={n.icon} /><span>{n.title}</span>{n.title === '이상 모아보기' && alertVehicles > 0 && <span className="nav-count">{alertVehicles}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="system-status"><span className="dot green" /><span>수집 시스템 정상<small>마지막 수신 14:32:08</small></span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="top-stats" aria-label="현황 요약">{[
          { title: '전체 차량', value: vehicles.length, unit: '대', sub: '전체 등록 차량 · 누르면 전체 목록', cls: '', go: () => goOverview('전체') },
          { title: '운행 중', value: counts.운행, unit: '대', sub: `전체 차량의 ${vehicles.length ? Math.round((counts.운행 / vehicles.length) * 100) : 0}%`, cls: 'green', go: () => goOverview('운행') },
          { title: '대기 중', value: counts.대기, unit: '대', sub: '이송 명령 대기 · 누르면 대기 차량 목록', cls: '', go: () => goOverview('대기') },
          { title: '이상 차량', value: counts.오류 + counts.경고 + counts.무수신, unit: '대', sub: `오류 ${counts.오류} · 경고 ${counts.경고} · 무수신 ${counts.무수신}`, cls: 'red', go: () => goOverview('이상') },
          { title: '로그 수집량', value: (vehicles.length * 60).toLocaleString(), unit: '건/s', sub: '수집 지연 0.24s', cls: 'blue', go: () => goOverview('전체') },
        ].map(t => <button key={t.title} type="button" className={`top-stat ${t.cls}`} title={t.sub} onClick={t.go}><span>{t.title}</span><strong>{t.value}<small>{t.unit}</small></strong></button>)}</div><div className="top-actions"><span className="demo-label">DEMO DATA</span><span className="network"><span className="dot green" /> 사내망 연결</span><span className="top-divider" /><button className="icon-button notification" aria-label="알림 보기" onClick={() => setNotice(!notice)}><Icon name="bell" />{alerts.length > 0 && <i>{alerts.length > 99 ? '99+' : alerts.length}</i>}</button></div></header>
      
      {notice && <AlertsPanel alerts={alerts} disabled={disabledRules} onAck={id => setAcked(prev => new Set(prev).add(id))} onAckAll={() => setAcked(prev => { const n = new Set(prev); for (const a of alerts) n.add(a.id); return n; })} onGoto={() => { setPage('이상 모아보기'); setNotice(false); }} onOpen={l => { setDetail(l); setNotice(false); }} />}
      <main>
        <div className="page-heading"><div><h1>{page}</h1><p>{overview ? '전체 레일과 차량 상태를 확인하고, 부품별 로그를 빠르게 탐색하세요.' : page === '로그 조회' ? '원문 검색과 차량·카테고리·판정·시간 범위 필터로 로그를 조회하세요.' : page === '로그 추이' ? '카테고리별 로그 건수와 이상 탐지 추이를 기간별로 확인하세요.'  : page === '이상 모아보기' ? '본문 규칙으로 탐지한 이상·주의 로그를 한곳에서 확인하고 규칙을 조정하세요.' : '차량별 로그를 시간순으로 조회하고 이벤트의 흐름을 확인하세요.'}</p></div><div className="heading-actions"><span className="date">2026. 10. 21 <span>14:32:08 KST</span></span><button className="button" onClick={() => setPaused(!paused)}><span className={`dot ${paused ? 'gray' : 'green'}`} />{paused ? '일시정지' : '실시간'}<Icon name="refresh" size={14} /></button></div></div>
        {overview ? <div className="visual-grid">
          <section className="panel rail-panel bare">
            <div className="rail-map">
              {focus
                ? <div className="map-follow"><button className="stage-btn back" onClick={clearSelection} title="전체 맵 보기로 돌아가기"><Icon name="chevron" size={12} />전체 차량</button><span>1F · {focusZoneName} · {selected.id}</span></div>
                : <div className="map-location"><span className="dot blue" /> 1F · 가상 레일 맵 · {map.bounds.w - 4} × {map.bounds.h - 4} m</div>}
              <div className="map-tools">{focus
                ? <><button className="stage-btn" onClick={() => setViewReset(n => n + 1)} title="차량 앞 시점으로 되돌리기"><Icon name="undo" size={12} />시점 되돌리기</button><button className={`stage-btn ${autoRotate ? 'on' : ''}`} onClick={() => setAutoRotate(r => !r)} aria-pressed={autoRotate} title={autoRotate ? '자동 회전 멈추기' : '차량 주위를 천천히 자동으로 돌기'}><Icon name="refresh" size={12} />자동 회전</button></>
                : <><button className={`stage-btn ${topView ? 'on' : ''}`} onClick={() => setTopView(t => !t)} aria-pressed={topView} title="바로 위에서 내려다보기"><Icon name="grid" size={12} />위에서 보기</button><select aria-label="구역 선택" value={area} onChange={e => setArea(e.target.value)}>{[['ALL', '전체 구역'], ['MAIN', '외곽 레일'], ...map.zones.map(z => [z.id, z.name])].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></>}</div>
              <Suspense fallback={<div className="viewer3d-loading">3D 맵 불러오는 중…</div>}><RailMap3D map={map} vehicles={vehicles} live={live} selectedId={focus ? selected.id : ''} onSelect={chooseVehicle} zone={area} statusFilter={listFilter} focus={mapFocus} top={topView} part={part} onPart={setPart} autoRotate={autoRotate} viewReset={viewReset} /></Suspense>
              {focus && <>
                <button className="device-nav prev" disabled={!neighbors.ahead} onClick={() => goNeighbor('prev')} title={neighbors.ahead ? `앞 차량 ${neighbors.ahead.id} · ${neighbors.ahead.distance.toFixed(1)} m` : '앞 차량 없음'} aria-label="앞 차량으로 이동"><Icon name="chevron" size={18} /><small>{neighbors.ahead?.id.replace('OHT-', '') ?? '—'}</small></button>
                <button className="device-nav next" disabled={!neighbors.behind} onClick={() => goNeighbor('next')} title={neighbors.behind ? `뒤 차량 ${neighbors.behind.id} · ${neighbors.behind.distance.toFixed(1)} m` : '뒤 차량 없음'} aria-label="뒤 차량으로 이동"><small>{neighbors.behind?.id.replace('OHT-', '') ?? '—'}</small><Icon name="chevron" size={18} /></button>
              </>}
              {focus && <div className="map-vehicle-name" aria-live="polite"><strong>{selected.id}</strong><span>{focusZoneName} · {displayStatus(selected)}</span></div>}
              {/* 차량을 따라가는 동안에는 다른 차량이 흐리게 보이므로 범례를 숨기고 그 자리를 기기명이 쓴다 */}
              {!focus && <div className="map-legend">{[['green', '운행'], ['gray', '대기'], ['amber', '경고'], ['red', '오류'], ['violet', '무수신']].map(([c, t]) => <span key={t}><span className={`dot ${c}`} />{t}</span>)}</div>}

            </div><div className="map-footer"><span><Icon name="box" size={14} /> {focus ? '선택한 차량을 따라가며 보여줍니다. 부품을 클릭하면 상세가 열리고, 드래그로 돌려 보거나 휠로 확대할 수 있습니다.' : '차량을 선택하면 가까이 다가가 부품별 상태를 확인할 수 있습니다. 왼쪽 드래그로 회전, 오른쪽 드래그로 이동, 휠로 확대합니다.'}</span><span>표시 차량 {vehicles.filter(v => area === 'ALL' || v.area === area).length} / {vehicles.length}</span></div>
          </section>
          {focus ? <DeviceDetailPanel vehicle={selected} map={map} lines={lines} part={part} onPart={setPart} lastSeen={selectedSeen} counts={selectedCounts} onRelatedLogs={p => { setPage('로그 조회'); setDevice(selected.id); setComponent(p); setSearch(''); }} /> : <VehicleListPanel vehicles={vehicles} map={map} lastSeen={id => logStream.lastSeen(id)} selectedId={selectedId} onSelect={chooseVehicle} filter={listFilter} onFilter={setListFilter} />}
          </div>  : page === '로그 조회' ? <section className="panel search-panel"><h2><Icon name="search" /> 로그 원문 검색</h2><p>원문 줄에 포함된 문자열로 검색합니다. 메시지뿐 아니라 노드 번호, OPS ID, MAC 주소 등 줄 전체가 대상입니다.</p><form onSubmit={e => { e.preventDefault(); setSearch(query); }}><div className="search-field"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={UI.searchPlaceholder} aria-label="로그 원문 검색어" /></div><button className="button primary">원문 검색</button></form><div className="search-hints">추천 검색어 {UI.searchHints.map(k => <button key={k} onClick={() => { setQuery(k); setSearch(k); }}>{k}</button>)}<span>시뮬레이터 형식 로그 · 원문 부분 문자열 검색</span></div></section> : page === '로그 추이' ? <TrendPage stream={logStream} vehicleCount={vehicles.length} version={lines.length ? lines[0].id : 0} lines={lines} /> : page === '이상 모아보기' ? <RulesPanel lines={lines} disabled={disabledRules} onToggle={toggleRule} /> : null}
        {page !== '로그 추이' && <LogsPanel lines={lines} filtered={filtered} timeRange={timeRange} setTimeRange={setTimeRange} vehicleIds={vehicleIds} selectedId={selectedId ?? ''} overview={overview} page={page} tab={tab} setTab={setTab} setPage={setPage} device={device} setDevice={setDevice} level={level} setLevel={setLevel} category={category} setCategory={setCategory} component={component} setComponent={setComponent} search={search} setSearch={setSearch} warning={warning} setWarning={setWarning} paused={paused} onDetail={setDetail} />}<footer className="footer"><span>LOG COLLECTOR <span>·</span> 내부 운영 시스템</span><span><span className="dot gray" /> 디자인 프로토타입 · 로그는 시뮬레이터 형식의 가상 데이터입니다.</span></footer>
      </main>
    </div>
    {detail && <LogDetailModal line={detail} lines={lines} onClose={() => setDetail(null)} />}
  </div>;
}
