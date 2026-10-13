import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { RailMap } from './map/railMap';
import type { FleetVehicle } from './map/useFleet';
import { matchesFilter, type ListFilter } from './VehicleListPanel';

const STATUS_FILL: Record<string, string> = { 오류: '#cd5b5b', 경고: '#d69b3b', 대기: '#94a3b8', 운행: '#53877d', 무수신: '#8e7cc3' };

interface Props {
  map: RailMap;
  vehicles: FleetVehicle[];
  selectedId: string;
  onSelect: (v: FleetVehicle) => void;
  /** 'ALL' 또는 구역 ID */
  zone: string;
  /** 상태 필터: '전체', 상태 하나, 또는 '이상'. 맞지 않는 차량은 흐리게 표시 */
  statusFilter?: ListFilter;
  zoom: number;
  onZoom: (z: number) => void;
}

/** 공용 레일 맵과 차량 위치를 그리는 2D 뷰. 좌표 단위는 m 이며 viewBox 로 그대로 쓴다. */
export default function RailMapView({ map, vehicles, selectedId, onSelect, zone, statusFilter = '전체', zoom, onZoom }: Props) {
  const { bounds } = map;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 화면 px → 맵 m 변환 비율
  const scale = () => {
    const el = svgRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    return Math.min(r.width / bounds.w, r.height / bounds.h) * zoom;
  };

  // 맵 이동(드래그). 포인터 캡처는 쓰지 않는다: 캡처하면 click 이 차량이 아니라 svg 로 가서 선택이 되지 않는다.
  // 드래그가 맵 밖에서 끝나도 정리되도록 pointerup 은 window 에서 받는다.
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
    window.addEventListener('pointerup', () => { drag.current = null; }, { once: true });
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.moved) { const s = scale(); setPan({ x: d.px + dx / s, y: d.py + dy / s }); }
  };
  const onPointerUp = () => { drag.current = null; };

  // 휠 확대. React 의 onWheel 은 passive 라 페이지 스크롤을 막을 수 없어서 네이티브 리스너를 쓴다.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: globalThis.WheelEvent) => {
      e.preventDefault();
      onZoom(Math.min(3, Math.max(0.8, +(zoomRef.current * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(2))));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [onZoom]);

  const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
  const transform = `translate(${cx} ${cy}) scale(${zoom}) translate(${-cx + pan.x} ${-cy + pan.y})`;
  const dim = (z: string) => (zone === 'ALL' || zone === z ? 1 : 0.22);
  const showLabel = (v: FleetVehicle) => zoom >= 1.4 || v.id === selectedId || v.id === hover || v.status === '오류' || v.status === '경고' || v.status === '무수신';
  const selected = vehicles.find(v => v.id === selectedId);

  return (
    <svg ref={svgRef} viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} className={`rail-svg ${drag.current?.moved ? 'panning' : ''}`} aria-label="2D OHT 레일 배치도"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <defs>
        <pattern id="dots" width="2" height="2" patternUnits="userSpaceOnUse"><circle cx="0.1" cy="0.1" r="0.09" fill="#dce2ea" /></pattern>
      </defs>
      <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="url(#dots)" />
      <g transform={transform}>
        {/* 구역(베이) */}
        {map.zones.map(z => (
          <g key={z.id} opacity={dim(z.id)}>
            <rect x={z.x - 1.6} y={z.y - 1.6} width={z.w + 3.2} height={z.h + 3.2} rx="0.8" fill="#edf1f6" stroke="#dfe5ed" strokeWidth="0.12" strokeDasharray="0.5 0.5" />
            <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 0.35} textAnchor="middle" fontSize="1.5" fontWeight="600" fill="#7e8b9e">{z.name}</text>
            <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 2.1} textAnchor="middle" fontSize="0.9" letterSpacing="0.15" fill="#a0aaba">{z.desc}</text>
          </g>
        ))}
        {/* 레일: 바깥 굵은 선 + 안쪽 밝은 선 */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {map.links.map(l => <path key={l.id} d={l.d} stroke={l.kind === 'connector' ? '#d4dbe5' : '#c5ceda'} strokeWidth="0.9" />)}
          {map.links.map(l => <path key={`i${l.id}`} d={l.d} stroke="#f7f9fc" strokeWidth="0.42" />)}
        </g>
        {/* 로드포트 */}
        {map.stations.map(s => (
          <g key={s.id} opacity={dim(s.bay)}>
            <rect x={s.x - 0.55} y={s.y - 0.4} width="1.1" height="0.8" rx="0.12" fill="#e8edf4" stroke="#cdd6e2" strokeWidth="0.08" />
          </g>
        ))}
        {/* 진행 방향 표시 */}
        {[0.25, 0.75].map(t => <text key={t} x={bounds.x + 2 + (bounds.w - 4) * t} y={0.5} fontSize="1.6" fill="#9aa8ba" textAnchor="middle">›</text>)}
        {/* 차량 */}
        {vehicles.map(v => {
          const deg = (v.heading * 180) / Math.PI;
          const sel = v.id === selectedId;
          return (
            <g key={v.id} className="map-vehicle" opacity={Math.min(dim(v.area), matchesFilter(v.status, statusFilter) ? 1 : 0.22)} onClick={() => onSelect(v)} onPointerDown={e => e.stopPropagation()} onPointerEnter={() => setHover(v.id)} onPointerLeave={() => setHover(null)}
              role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect(v)} aria-label={`${v.id} ${v.status} 선택`}>
              {sel && <><circle cx={v.x} cy={v.y} r="2.2" fill="#fbe9e9" /><circle cx={v.x} cy={v.y} r="2.1" fill="none" stroke="#d78686" strokeWidth="0.12" strokeDasharray="0.3 0.3" /></>}
              <g transform={`translate(${v.x} ${v.y}) rotate(${deg})`}>
                <rect x="-0.9" y="-0.55" width="1.8" height="1.1" rx="0.25" fill={STATUS_FILL[v.status]} stroke="white" strokeWidth="0.14" />
                <rect x="-0.45" y="-0.3" width="0.9" height="0.6" rx="0.1" fill="white" opacity=".7" />
                <path d="M0.9 0 l-0.35 -0.3 v0.6 z" fill="white" opacity=".9" />
              </g>
              {showLabel(v) && (
                <g>
                  <rect x={v.x - 3} y={v.y - 3.1} width="6" height="1.5" rx="0.25" fill={sel ? '#fff1f0' : '#fff'} stroke={sel ? '#edc3c1' : '#e1e6ed'} strokeWidth="0.08" />
                  <text x={v.x} y={v.y - 2.0} textAnchor="middle" fill={v.status === '오류' ? '#b34646' : '#607087'} fontSize="0.95" fontWeight="500">{v.id}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>
      {selected && <text x={bounds.x + bounds.w - 1} y={bounds.y + bounds.h - 1} textAnchor="end" fontSize="1" fill="#9aa6b5">{selected.id} · {selected.area === 'MAIN' ? '외곽 레일' : map.zones.find(z => z.id === selected.area)?.name} · {selected.driving ? `${(selected.vel / 1000).toFixed(1)} m/s` : '정차'}</text>}
    </svg>
  );
}
