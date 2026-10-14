import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, Badge, type IconName } from './ui';
import LogsPanel from './LogsPanel';
import LogDetailModal from './LogDetailModal';
import TrendPage from './TrendPage';
import RulesPanel from './RulesPanel';
import VehicleListPanel, { type ListFilter } from './VehicleListPanel';
import { railNeighbors } from './map/neighbors';
import AlertsPanel from './AlertsPanel';
import { rangeBounds, type TimeRange } from './LogsPanel';
import { filterLogs, fmtClock, fmtAgo, effectiveSeverity, SEVERITY_LABEL, type LogLine } from './logs/logStream';
import RailMapView from './RailMapView';
import { useFleet, useLogLines, displayStatus, type FleetVehicle } from './map/useFleet';
import { getPartStatus, type PartName } from './partStatus';
import { UI } from './logs/messages';

const VehicleViewer3D = lazy(() => import('./VehicleViewer3D'));

const FALLBACK_VEHICLE: FleetVehicle = { id: 'OHT-0024', status: '오류', part: '주행부', area: 'MAIN', x: 0, y: 0, heading: 0, driving: false, vel: 0, linkId: 0, progress: 0 };
const nav = [
  { title: '전체 관제', icon: 'grid' }, { title: '로그 조회', icon: 'logs' }, { title: '로그 추이', icon: 'expand' }, { title: '이상 모아보기', icon: 'alert' },
] as const;

export default function App() {
  const [page, setPage] = useState('전체 관제');
  const { map, vehicles, logStream } = useFleet(30);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<ListFilter>('전체');
  // 앞·뒤 차량 이동 시 3D 뷰 스와이프 효과 (n 이 바뀔 때마다 애니메이션 재생)
  const [swipe, setSwipe] = useState<{ dir: 'prev' | 'next'; n: number }>({ dir: 'next', n: 0 });
  // 3D 캔버스를 다시 만들지 않고(깜빡임 원인) 감싼 요소에만 애니메이션을 건다. 그리기 전에 시작해야 새 화면이 먼저 보이지 않는다.
  const stageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!swipe.n || !el) return;
    for (const a of el.getAnimations()) a.cancel();
    const from = swipe.dir === 'next' ? 70 : -70;
    el.animate([{ transform: `translateX(${from}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }, [swipe]);
  function goNeighbor(dir: 'prev' | 'next') { const id = dir === 'prev' ? neighbors.ahead?.id : neighbors.behind?.id; /* 왼쪽 화살표 = 앞 차량, 오른쪽 = 뒤 차량 */ const v = vehicles.find(x => x.id === id); if (!v) return; chooseVehicle(v); setSwipe(sw => ({ dir, n: sw.n + 1 })); }
  /** 상단바 항목 클릭: 해당 필터가 적용된 전체 관제로 이동 */
  function goOverview(filter: ListFilter, scrollTo?: string) {
    setPage('전체 관제'); setSelectedId(null); setListFilter(filter);
    if (scrollTo) setTimeout(() => document.querySelector(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const selected = vehicles.find(v => v.id === selectedId) ?? vehicles[0] ?? FALLBACK_VEHICLE;
  // 3D 뷰어는 위치가 아니라 상태·부품만 보므로, 매 틱 새 객체를 넘기지 않는다
  const viewerVehicle = useMemo(() => ({ id: selected.id, status: selected.status, part: selected.part }), [selected.id, selected.status, selected.part]);
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
  const [zoom, setZoom] = useState(1);
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
  const filtered = filterLogs(lines, { part: component, errorsOnly: page === '이상 모아보기', includeWarn: warning, severity: level, category, vehicle: device, onlyVehicle: tab === '선택 차량 로그' ? selected.id : '', search, ...rangeBounds(timeRange, Date.now()), disabledRules });
  function chooseVehicle(v: FleetVehicle) { setSelectedId(v.id); setPart(v.part); }
  function clearSelection() { setSelectedId(null); if (tab === '선택 차량 로그') setTab('전체 로그'); }
  const focus = selectedId !== null && vehicles.some(v => v.id === selectedId);
  const selectedSeen = focus ? logStream.lastSeen(selected.id) : undefined;
  // 위치 로그 기준 앞·뒤 차량 (레일을 따라 250 m 이내)
  const neighbors = useMemo(() => (focus ? railNeighbors(map, vehicles, selected.id) : { ahead: null, behind: null }), [focus, map, vehicles, selected.id]);
  const selectedCounts = useMemo(() => { let err = 0, warn = 0; for (const l of lines) if (l.vehicle === selected.id) { const sv = effectiveSeverity(l, disabledRules); if (sv === 'ERROR') err++; else if (sv === 'WARN') warn++; } return { err, warn }; }, [lines, selected.id, disabledRules]);
  const overview = page === '전체 관제';
  const partInfo = getPartStatus(selected, part as PartName);
  const partLog = lines.find(l => l.vehicle === selected.id && l.part === part);
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
        <div className="page-heading"><div><div className="eyebrow">OHT OPERATIONS</div><h1>{page}</h1><p>{overview ? '전체 레일과 차량 상태를 확인하고, 부품별 로그를 빠르게 탐색하세요.' : page === '로그 조회' ? '원문 검색과 차량·카테고리·판정·시간 범위 필터로 로그를 조회하세요.' : page === '로그 추이' ? '카테고리별 로그 건수와 이상 탐지 추이를 기간별로 확인하세요.'  : page === '이상 모아보기' ? '본문 규칙으로 탐지한 이상·주의 로그를 한곳에서 확인하고 규칙을 조정하세요.' : '차량별 로그를 시간순으로 조회하고 이벤트의 흐름을 확인하세요.'}</p></div><div className="heading-actions"><span className="date">2026. 10. 21 <span>14:32:08 KST</span></span><button className="button" onClick={() => setPaused(!paused)}><span className={`dot ${paused ? 'gray' : 'green'}`} />{paused ? '일시정지' : '실시간'}<Icon name="refresh" size={14} /></button></div></div>
        {overview ? <div className="visual-grid">
          <section className={`panel rail-panel ${focus ? 'focus' : 'bare'}`}>{focus ? <>
            <div className="panel-header"><div><h2>차량 3D 뷰 <span className="live-tag">{selected.id}</span></h2><span className="panel-sub">드래그로 회전, 휠로 확대 · 부품을 클릭하면 우측에 상태가 표시됩니다</span></div><div className="panel-tools"><button className="button" onClick={clearSelection}>레일 맵으로 돌아가기</button></div></div>
            <div className="rail-map viewer-stage"><div ref={stageRef} className="stage-anim"><Suspense fallback={<div className="viewer3d-loading">3D 모델 불러오는 중…</div>}><VehicleViewer3D vehicle={viewerVehicle} part={part} onPart={setPart} /></Suspense></div>
              <button className="stage-nav prev" disabled={!neighbors.ahead} onClick={() => goNeighbor('prev')} title="레일 위 바로 앞 차량으로 이동" aria-label="앞 차량으로 이동"><Icon name="chevron" size={22} /><span><small>앞 차량</small><strong>{neighbors.ahead ? neighbors.ahead.id : '없음'}</strong>{neighbors.ahead && <em>{neighbors.ahead.distance.toFixed(1)} m</em>}</span></button>
              <button className="stage-nav next" disabled={!neighbors.behind} onClick={() => goNeighbor('next')} title="레일 위 바로 뒤 차량으로 이동" aria-label="뒤 차량으로 이동"><span><small>뒤 차량</small><strong>{neighbors.behind ? neighbors.behind.id : '없음'}</strong>{neighbors.behind && <em>{neighbors.behind.distance.toFixed(1)} m</em>}</span><Icon name="chevron" size={22} /></button></div>
            <div className="map-footer"><span><Icon name="box" size={14} /> 선택 부품 {part} · 드래그 회전 · 휠 확대 · 부품 클릭 선택</span><span>{displayStatus(selected)}</span></div>
          </> : <>
            <div className="rail-map"><div className="map-location"><span className="dot blue" /> 1F · 가상 레일 맵 · {map.bounds.w - 4} × {map.bounds.h - 4} m</div><div className="map-tools"><select aria-label="구역 선택" value={area} onChange={e => setArea(e.target.value)}>{[['ALL', '전체 구역'], ['MAIN', '외곽 레일'], ...map.zones.map(z => [z.id, z.name])].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><button className="icon-button" aria-label="맵 확대" onClick={() => setZoom(zoom === 1 ? 1.5 : 1)}><Icon name="expand" size={16} /></button></div>
              <RailMapView map={map} vehicles={vehicles} selectedId={selectedId ?? ''} onSelect={chooseVehicle} zone={area} statusFilter={listFilter} zoom={zoom} onZoom={setZoom} />
              <div className="map-legend">{[['green', '운행'], ['gray', '대기'], ['amber', '경고'], ['red', '오류'], ['violet', '무수신']].map(([c, t]) => <span key={t}><span className={`dot ${c}`} />{t}</span>)}</div><div className="zoom-controls"><button onClick={() => setZoom(Math.min(3, +(zoom + .25).toFixed(2)))} aria-label="확대">+</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(Math.max(.8, +(zoom - .25).toFixed(2)))} aria-label="축소">−</button></div>
            </div><div className="map-footer"><span><Icon name="box" size={14} /> 차량을 선택하면 상세 정보와 부품별 로그를 확인할 수 있습니다. 드래그로 이동, 휠로 확대합니다.</span><span>표시 차량 {vehicles.filter(v => area === 'ALL' || v.area === area).length} / {vehicles.length}</span></div>
          </>}</section>
          {focus ? <section className="panel vehicle-panel">
            <div className="panel-header"><h2>기기 정보</h2><button className="text-button" onClick={clearSelection}>목록으로 <Icon name="chevron" size={12} /></button></div>
            <div className="vehicle-title"><div><strong>{selected.id}</strong><span>FAB 01 · {selected.area === 'MAIN' ? '외곽 레일' : map.zones.find(z => z.id === selected.area)?.name ?? selected.area}</span></div><Badge text={displayStatus(selected)} /></div>
            <dl className="vehicle-facts">
              <div><dt>위치</dt><dd>{selected.area === 'MAIN' ? '외곽 레일' : map.zones.find(z => z.id === selected.area)?.name ?? selected.area}</dd></div>
              <div><dt>속도</dt><dd>{selected.driving ? `${(selected.vel / 1000).toFixed(1)} m/s` : '정차'}</dd></div>
              <div className={selectedSeen === undefined || Date.now() - selectedSeen > 30000 ? 'alert' : ''}><dt>최근 수신</dt><dd>{selectedSeen ? fmtAgo(Date.now() - selectedSeen) : '수신 없음'}</dd></div>
              <div className={selectedCounts.err ? 'alert' : ''}><dt>이상 · 주의</dt><dd>{selectedCounts.err} · {selectedCounts.warn}</dd></div>
            </dl>
            <div className="component-status"><div className="cs-head"><span className="component-symbol"><Icon name="settings" size={18} /></span><div><strong>{part}</strong><small>{partInfo.summary}</small></div><span className={`part-level lv-${partInfo.level}`}>{partInfo.level}</span></div><dl className="part-metrics">{partInfo.metrics.map(m => <div key={m.label} className={m.alert ? 'alert' : ''}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl><div className="part-last-log"><span>최근 로그</span>{partLog ? <p title={partLog.raw}><Badge text={SEVERITY_LABEL[partLog.severity]} /><span className="mono">{fmtClock(partLog.time)}</span><em>{partLog.reason ?? partLog.msg}</em></p> : <p className="no-log">최근 보관 구간에 이 부품 관련 로그가 없습니다.</p>}</div><button onClick={() => { setPage('로그 조회'); setDevice(selected.id); setComponent(part); setSearch(''); }}>관련 로그 조회 <Icon name="chevron" size={14} /></button></div></section> : <VehicleListPanel vehicles={vehicles} map={map} lastSeen={id => logStream.lastSeen(id)} selectedId={selectedId} onSelect={chooseVehicle} filter={listFilter} onFilter={setListFilter} />}
          </div>  : page === '로그 조회' ? <section className="panel search-panel"><h2><Icon name="search" /> 로그 원문 검색</h2><p>원문 줄에 포함된 문자열로 검색합니다. 메시지뿐 아니라 노드 번호, OPS ID, MAC 주소 등 줄 전체가 대상입니다.</p><form onSubmit={e => { e.preventDefault(); setSearch(query); }}><div className="search-field"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={UI.searchPlaceholder} aria-label="로그 원문 검색어" /></div><button className="button primary">원문 검색</button></form><div className="search-hints">추천 검색어 {UI.searchHints.map(k => <button key={k} onClick={() => { setQuery(k); setSearch(k); }}>{k}</button>)}<span>시뮬레이터 형식 로그 · 원문 부분 문자열 검색</span></div></section> : page === '로그 추이' ? <TrendPage stream={logStream} vehicleCount={vehicles.length} version={lines.length ? lines[0].id : 0} lines={lines} /> : page === '이상 모아보기' ? <RulesPanel lines={lines} disabled={disabledRules} onToggle={toggleRule} /> : null}
        {page !== '로그 추이' && <LogsPanel lines={lines} filtered={filtered} timeRange={timeRange} setTimeRange={setTimeRange} vehicleIds={vehicles.map(v => v.id)} selectedId={selectedId ?? ''} overview={overview} page={page} tab={tab} setTab={setTab} setPage={setPage} device={device} setDevice={setDevice} level={level} setLevel={setLevel} category={category} setCategory={setCategory} component={component} setComponent={setComponent} search={search} setSearch={setSearch} warning={warning} setWarning={setWarning} paused={paused} onDetail={setDetail} />}<footer className="footer"><span>LOG COLLECTOR <span>·</span> 내부 운영 시스템</span><span><span className="dot gray" /> 디자인 프로토타입 · 로그는 시뮬레이터 형식의 가상 데이터입니다.</span></footer>
      </main>
    </div>
    {detail && <LogDetailModal line={detail} lines={lines} onClose={() => setDetail(null)} />}
  </div>;
}
