import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BufferGeometry, CurvePath, LineCurve3, TubeGeometry, Vector3, type Group, type PerspectiveCamera } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { poseOnLink, type MapLink, type MapRect, type RailMap } from './map/railMap';
import type { FleetVehicle } from './map/useFleet';
import { matchesFilter, type ListFilter } from './VehicleListPanel';
import { MODEL_RAIL_Y, VehicleModel } from './VehicleViewer3D';
import type { PartName } from './partStatus';

export const STATUS_FILL: Record<string, string> = { 오류: '#cd5b5b', 경고: '#d69b3b', 대기: '#94a3b8', 운행: '#53877d', 무수신: '#8e7cc3' };

interface Props {
  map: RailMap;
  vehicles: FleetVehicle[];
  /** 매 틱 갱신되는 최신 차량 위치 (vehicles 는 화면 갱신 간격으로만 바뀐다) */
  live?: RefObject<FleetVehicle[]>;
  /** 상세를 보는 차량. 있으면 카메라가 그 차량을 따라가고, 차량은 부품을 고를 수 있는 상세 모델로 바뀐다 */
  selectedId: string;
  onSelect: (v: FleetVehicle) => void;
  /** 'ALL' 또는 구역 ID */
  zone: string;
  statusFilter?: ListFilter;
  /** 전체 보기에서 확대해 보여줄 영역. null 이면 맵 전체 */
  focus?: MapRect | null;
  /** 바로 위에서 내려다보기 */
  top?: boolean;
  part: string;
  onPart: (p: string) => void;
  /** 차량 주위를 천천히 자동으로 돈다. 드래그 회전은 늘 된다 */
  autoRotate?: boolean;
  /** 값이 바뀔 때마다 차량 앞 시점으로 되돌린다 */
  viewReset?: number;
}

// 맵 좌표(m)를 그대로 쓴다: 2D 의 x → X, y → Z, 높이는 Y.
const RAIL_Y = 3.2;
/** 상세 모델을 볼 때 카메라가 바라보는 높이 (차량 몸통 가운데) */
const BODY_Y = RAIL_Y - 0.85;
/** 차량 앞 시점: 앞면(+Z)에서 떨어진 거리와 눈높이(m) */
const FRONT_DIST = 8;
const FRONT_UP = 1.3;
/** 상세 모델 배율 (단순 차량 모형과 같은 크기) */
const MODEL_SCALE = 1.3;
type Vec3 = [number, number, number];
type Pose = { x: number; z: number; h: number };

/** 링크를 따라가는 레일 관(管) 형상. 곡선 링크는 잘게 나눠 꺾은선으로 만든다. */
function linkTube(map: RailMap, l: MapLink, radius: number): BufferGeometry {
  const n = l.arc ? 10 : 1;
  const path = new CurvePath<Vector3>();
  let prev: Vector3 | null = null;
  for (let i = 0; i <= n; i++) {
    const p = poseOnLink(map, l, i / n);
    const v = new Vector3(p.x, RAIL_Y, p.y);
    if (prev) path.add(new LineCurve3(prev, v));
    prev = v;
  }
  return new TubeGeometry(path, n, radius, 5, false);
}

function Rails({ map }: { map: RailMap }) {
  const [main, link] = useMemo(() => {
    const main = mergeGeometries(map.links.filter(l => l.kind !== 'connector').map(l => linkTube(map, l, 0.16)));
    const conn = mergeGeometries(map.links.filter(l => l.kind === 'connector').map(l => linkTube(map, l, 0.13)));
    return [main, conn];
  }, [map]);
  useEffect(() => () => { main?.dispose(); link?.dispose(); }, [main, link]);
  return (
    <group>
      {main && <mesh geometry={main}><meshStandardMaterial color="#aeb8c5" metalness={0.4} roughness={0.45} /></mesh>}
      {link && <mesh geometry={link}><meshStandardMaterial color="#c3cbd6" metalness={0.4} roughness={0.45} /></mesh>}
    </group>
  );
}

function Floor({ map, zone }: { map: RailMap; zone: string }) {
  const dim = (z: string) => (zone === 'ALL' || zone === z ? 1 : 0.3);
  return (
    <group>
      {/* 바닥면은 그리지 않는다(서비스 배경이 그대로 보이게). 베이 구역만 옅게 깐다 */}
      {map.zones.map(z => (
        <mesh key={z.id} position={[z.x + z.w / 2, 0.03, z.y + z.h / 2]}>
          <boxGeometry args={[z.w + 3.2, 0.06, z.h + 3.2]} />
          <meshBasicMaterial color="#edf1f6" transparent opacity={dim(z.id)} />
        </mesh>
      ))}
      {/* 로드포트(설비): 레일 아래 바닥에 놓인 상자 */}
      {map.stations.map(s => (
        <mesh key={s.id} position={[s.x, 0.45, s.y]}>
          <boxGeometry args={[1.1, 0.9, 0.8]} />
          <meshStandardMaterial color="#d9dfe7" transparent opacity={dim(s.bay)} />
        </mesh>
      ))}
    </group>
  );
}

/** 각도 a 에서 b 로 가장 짧은 방향으로 t 만큼 보간 */
const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;

/**
 * 레일에 매달린 차량. 위치는 100 ms 마다 갱신되므로 화면에서는 부드럽게 따라가게 하고, 그 위치를 poses 에 기록한다(카메라 추적용).
 * 상세를 보는 차량은 부품을 고를 수 있는 상세 모델로 그린다.
 */
function Vehicle3D({ v, latest, opacity, detail, poses, interactive, onSelect, onHover }: {
  v: FleetVehicle; opacity: number; poses: RefObject<Map<string, Pose>>;
  /** 최신 차량 위치. 위치가 바뀔 때마다 다시 그리지 않고 매 프레임 여기서 읽는다 */
  latest: RefObject<FleetVehicle[]>;
  /** 클릭·호버로 고를 수 있는지. 다른 차량을 보는 중에는 부품 클릭을 가로채지 않도록 끈다 */
  interactive: boolean;
  detail?: { part: string; onPart: (p: PartName) => void; onPartHover: (p: PartName | null) => void; tags: { hover: RefObject<HTMLSpanElement | null>; selected: RefObject<HTMLSpanElement | null> } };
  onSelect: (v: FleetVehicle) => void; onHover: (id: string | null) => void;
}) {
  const g = useRef<Group>(null);
  useFrame((_, delta) => {
    const node = g.current;
    if (!node) return;
    const t = latest.current?.find(x => x.id === v.id) ?? v;
    let p = poses.current?.get(t.id);
    if (!p || Math.hypot(p.x - t.x, p.z - t.y) > 4) p = { x: t.x, z: t.y, h: t.heading };
    else {
      const k = 1 - Math.exp(-delta * 12);
      p = { x: p.x + (t.x - p.x) * k, z: p.z + (t.y - p.z) * k, h: lerpAngle(p.h, t.heading, k) };
    }
    poses.current?.set(t.id, p);
    node.position.set(p.x, 0, p.z);
    node.rotation.y = -p.h;
  });

  const lite = useMemo(() => ({ id: v.id, status: v.status, part: v.part }), [v.id, v.status, v.part]);
  const color = STATUS_FILL[v.status];
  const fade = opacity < 1;
  return (
    <group ref={g} position={[v.x, 0, v.y]} rotation={[0, -v.heading, 0]}>
      {detail ? (
        // 다른 차량(1.3배)과 크기를 맞추고, 모델의 레일 높이를 맵 레일에 맞춘다
        <group position={[0, RAIL_Y - MODEL_RAIL_Y * MODEL_SCALE, 0]} scale={MODEL_SCALE}>
          <VehicleModel vehicle={lite} part={detail.part} onPart={detail.onPart} onHover={detail.onPartHover} tags={detail.tags} />
        </group>
      ) : (
        <group position={[0, RAIL_Y, 0]} scale={1.3} {...(interactive ? {
          onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.delta <= 4) onSelect(v); },
          onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(v.id); },
          onPointerOut: () => onHover(null),
        } : {})}>
          {/* 클릭 영역: 차량이 작아 보여도 고르기 쉽도록 보이지 않는 큰 상자를 둔다 */}
          {interactive && <mesh position={[0, -0.6, 0]}>
            <boxGeometry args={[2.6, 2.0, 2.0]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>}
          {/* 주행부 + 본체 */}
          <mesh position={[0, -0.12, 0]}>
            <boxGeometry args={[1.0, 0.24, 0.5]} />
            <meshStandardMaterial color="#5c5c5c" transparent opacity={opacity} depthWrite={!fade} />
          </mesh>
          <mesh position={[0, -0.75, 0]}>
            <boxGeometry args={[1.5, 1.0, 1.0]} />
            <meshStandardMaterial color={color} roughness={0.5} transparent opacity={opacity} depthWrite={!fade} />
          </mesh>
          {/* 진행 방향 표시 */}
          <mesh position={[0.78, -0.75, 0]}>
            <boxGeometry args={[0.06, 0.5, 0.6]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.85 * opacity} depthWrite={!fade} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// 차량 위치는 0.1초마다 바뀌지만 3D 장면을 그때마다 다시 그리면 화면이 끊긴다.
// 바닥·레일은 맵·구역이 바뀔 때만, 차량은 상태·선택·흐림이 바뀔 때만 다시 그리고, 위치는 매 프레임 latest 에서 읽는다.
const RailsM = memo(Rails);
const FloorM = memo(Floor);
const Vehicle3DM = memo(Vehicle3D, (a, b) =>
  a.v.id === b.v.id && a.v.status === b.v.status && a.v.part === b.v.part &&
  a.opacity === b.opacity && a.detail === b.detail && a.interactive === b.interactive &&
  a.onSelect === b.onSelect && a.onHover === b.onHover && a.latest === b.latest && a.poses === b.poses);

type Label = { key: string; pos: Vec3; id?: string };

/** 3D 좌표를 화면 좌표로 바꿔 HTML 이름표를 따라다니게 한다. 차량 이름표는 부드럽게 움직이는 차량 위치를 따른다. */
function LabelTracker({ items, els, poses }: { items: RefObject<Label[]>; els: RefObject<Map<string, HTMLElement>>; poses: RefObject<Map<string, Pose>> }) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const it of items.current ?? []) {
      const el = els.current?.get(it.key);
      if (!el) continue;
      const p = it.id ? poses.current?.get(it.id) : undefined;
      if (p) v.set(p.x, it.pos[1], p.z); else v.set(...it.pos);
      v.project(camera);
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`;
      el.style.visibility = v.z < 1 ? 'visible' : 'hidden';
    }
  });
  return null;
}

type Controls = {
  target: Vector3; update: () => void; enabled: boolean;
  addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void;
};

/**
 * 카메라 움직임.
 * - 전체 보기: 보여줄 영역(맵 전체·고른 구역)이 화면을 채우도록 비스듬히(또는 바로 위에서) 내려다본다.
 * - 차량 상세: 그 차량으로 날아가 가까이 붙고, 차량이 움직이면 같이 따라간다. 천천히 주위를 돈다(시점 고정·드래그·부품 호버 중엔 멈춤).
 */
function CameraRig({ map, focus, top, followId, poses, autoRotate, viewReset, paused }: {
  map: RailMap; focus: MapRect | null; top: boolean; followId: string; poses: RefObject<Map<string, Pose>>; autoRotate: boolean; viewReset: number; paused: boolean;
}) {
  const camera = useThree(st => st.camera) as PerspectiveCamera;
  const controls = useThree(st => st.controls) as unknown as Controls | null;
  const { width, height } = useThree(st => st.size);
  const goal = useRef<{ pos: Vector3; target: Vector3 } | null>(null);
  /** 차량으로 날아가는 중. user = 그 사이 사용자가 직접 돌려서, 각도는 사용자 것을 따르고 위치만 따라간다 */
  const fly = useRef<{ offset: Vector3 | null; user?: boolean } | null>(null);
  const busyUntil = useRef(0);
  const first = useRef(true);
  const lastH = useRef<number | null>(null);
  const focusKey = focus ? `${focus.x.toFixed(1)},${focus.y.toFixed(1)},${focus.w},${focus.h}` : '';

  // 전체 보기 목표 위치
  useEffect(() => {
    if (followId || !width || !height) return;
    const r = focus ? { x: focus.x - 4, y: focus.y - 4, w: focus.w + 8, h: focus.h + 9 } : map.bounds;
    const cx = r.x + r.w / 2, cz = r.y + r.h / 2;
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * (width / height));
    const elev = top ? 1.56 : 0.95; // 바로 위 / 약 54도
    const d = Math.max((r.w / 2 + 3) / Math.tan(hf / 2), ((r.h / 2 + 3) * Math.sin(elev) + RAIL_Y) / Math.tan(vf / 2));
    const pos = new Vector3(cx, d * Math.sin(elev), cz + d * Math.cos(elev));
    const target = new Vector3(cx, 0, cz);
    if (first.current || !controls) {
      first.current = !controls;
      camera.position.copy(pos);
      camera.lookAt(target);
      if (controls) { controls.target.copy(target); controls.update(); }
      goal.current = null;
    } else goal.current = { pos, target };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focusKey, top, followId, camera, controls, width, height]);

  // 차량 상세로 들어가면 그 차량으로 날아간다
  useEffect(() => {
    // 차량을 고르거나 '시점 되돌리기'를 누르면 그 차량의 앞 시점으로 날아간다
    if (followId) { fly.current = { offset: null }; goal.current = null; }
    else fly.current = null;
    lastH.current = null;
  }, [followId, viewReset]);

  // 사용자가 직접 돌리면 이동·자동 회전을 잠시 멈춘다
  useEffect(() => {
    if (!controls?.addEventListener) return;
    const start = () => { goal.current = null; busyUntil.current = Number.POSITIVE_INFINITY; if (fly.current) fly.current.user = true; };
    const end = () => { busyUntil.current = performance.now() + 1500; };
    controls.addEventListener('start', start);
    controls.addEventListener('end', end);
    return () => { controls.removeEventListener?.('start', start); controls.removeEventListener?.('end', end); };
  }, [controls]);

  const off = useMemo(() => new Vector3(), []);
  const tgt = useMemo(() => new Vector3(), []);
  useFrame((_, delta) => {
    if (!controls) return;
    const dt = Math.min(delta, 0.1);
    if (followId) {
      const p = poses.current?.get(followId);
      if (!p) return;
      tgt.set(p.x, BODY_Y, p.z);
      const f = fly.current;
      if (f) {
        // 차량 앞면(+Z)을 정면에서 바라본다
        if (!f.offset) f.offset = new Vector3(-Math.sin(p.h) * FRONT_DIST, FRONT_UP, Math.cos(p.h) * FRONT_DIST);
        const k = 1 - Math.exp(-dt * 3.5);
        off.copy(camera.position).sub(controls.target);
        if (!f.user) off.lerp(f.offset, k);
        controls.target.lerp(tgt, k);
        camera.position.copy(controls.target).add(off);
        if (controls.target.distanceTo(tgt) < 0.03 && (f.user || off.distanceTo(f.offset) < 0.05)) fly.current = null;
      } else {
        off.copy(tgt).sub(controls.target);
        controls.target.add(off);
        camera.position.add(off);
        // 차량이 곡선에서 방향을 틀면 카메라도 같이 돌려, 사용자가 맞춘 각도(처음엔 앞 시점)를 유지한다.
        // 자동 회전을 켜면 천천히 주위를 돈다(드래그·부품 호버 중엔 멈춤)
        let a = lastH.current === null ? 0 : (((p.h - lastH.current + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (autoRotate && !paused && performance.now() > busyUntil.current) a += (Math.PI * 2 / 40) * dt;
        if (a) {
          off.copy(camera.position).sub(controls.target);
          const x = off.x * Math.cos(a) - off.z * Math.sin(a), z = off.x * Math.sin(a) + off.z * Math.cos(a);
          camera.position.set(controls.target.x + x, camera.position.y, controls.target.z + z);
        }
      }
      lastH.current = p.h;
      controls.update();
      return;
    }
    const gl = goal.current;
    if (!gl) return;
    const k = 1 - Math.exp(-dt * 5);
    camera.position.lerp(gl.pos, k);
    controls.target.lerp(gl.target, k);
    controls.update();
    if (camera.position.distanceTo(gl.pos) < 0.05 && controls.target.distanceTo(gl.target) < 0.05) goal.current = null;
  });
  return null;
}

/** 공용 레일 맵의 3D 보기. 레일은 천장 높이에 걸려 있고 차량은 레일에 매달려 움직인다. 차량을 고르면 그 차량에 다가가 부품을 고를 수 있다. */
export default function RailMap3D({ map, vehicles, live, selectedId, onSelect, zone, statusFilter = '전체', focus = null, top = false, part, onPart, autoRotate = false, viewReset = 0 }: Props) {
  const { bounds } = map;
  const [hover, setHover] = useState<string | null>(null);
  const [partHover, setPartHover] = useState<PartName | null>(null);
  const poses = useRef(new Map<string, Pose>());
  const hoverTag = useRef<HTMLSpanElement>(null);
  const selectedTag = useRef<HTMLSpanElement>(null);
  const following = !!selectedId && vehicles.some(v => v.id === selectedId);
  const cx = bounds.x + bounds.w / 2, cz = bounds.y + bounds.h / 2;
  const selectedPart = part || null;
  // 같은 부품을 다시 누르면 선택 해제
  const togglePart = useCallback((n: PartName) => onPart(n === part ? '' : n), [onPart, part]);
  const tags = useMemo(() => ({ hover: hoverTag, selected: selectedTag }), []);
  const detail = useMemo(() => ({ part, onPart: togglePart, onPartHover: setPartHover, tags }), [part, togglePart, tags]);
  const own = useRef<FleetVehicle[]>([]);
  own.current = vehicles;
  const latest = live ?? own;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const select = useCallback((v: FleetVehicle) => onSelectRef.current(v), []);
  const hoverPart = partHover && partHover !== selectedPart ? partHover : null;

  useEffect(() => {
    if (partHover) return;
    document.body.style.cursor = hover ? 'pointer' : '';
    return () => { document.body.style.cursor = ''; };
  }, [hover, partHover]);
  useEffect(() => { setPartHover(null); }, [selectedId]);

  const dim = (z: string) => (zone === 'ALL' || zone === z ? 1 : 0.22);
  const showLabel = (v: FleetVehicle) => v.id !== selectedId && (v.id === hover || v.status === '오류' || v.status === '경고' || v.status === '무수신');
  const labelled = vehicles.filter(showLabel);

  const items = useRef<Label[]>([]);
  items.current = [
    ...map.zones.map((z): Label => ({ key: `z-${z.id}`, pos: [z.x + z.w / 2, 0.1, z.y + z.h + 2.2] })),
    ...labelled.map((v): Label => ({ key: `v-${v.id}`, id: v.id, pos: [v.x, RAIL_Y + 0.5, v.y] })),
  ];
  const els = useRef(new Map<string, HTMLElement>());
  const bind = (key: string) => (el: HTMLElement | null) => { if (el) els.current.set(key, el); else els.current.delete(key); };

  return (
    <div className="rail3d">
      <Canvas dpr={[1, 1.5]} camera={{ position: [cx, 60, cz + 50], fov: 35, near: 0.3, far: 2000 }}
        gl={{ antialias: true, alpha: true }} onPointerMissed={() => { setHover(null); setPartHover(null); }} aria-label="3D OHT 레일 배치도">
        <ambientLight intensity={0.75} />
        <hemisphereLight args={['#ffffff', '#d5d9df', 0.55]} />
        <directionalLight position={[cx + 30, 60, cz + 40]} intensity={1.1} />
        <directionalLight position={[cx - 30, 20, cz - 30]} intensity={0.35} />
        <FloorM map={map} zone={zone} />
        <RailsM map={map} />
        {vehicles.map(v => {
          const sel = following && v.id === selectedId;
          return (
            <Vehicle3DM key={v.id} v={v} latest={latest} poses={poses} interactive={!following} onSelect={select} onHover={setHover}
              detail={sel ? detail : undefined}
              opacity={Math.min(dim(v.area), matchesFilter(v.status, statusFilter) ? 1 : 0.22, following && !sel ? 0.16 : 1)} />
          );
        })}
        <LabelTracker items={items} els={els} poses={poses} />
        <CameraRig map={map} focus={focus} top={top} followId={following ? selectedId : ''} poses={poses} autoRotate={autoRotate} viewReset={viewReset} paused={!!partHover} />
        <OrbitControls makeDefault target={[cx, 0, cz]} enableDamping screenSpacePanning={false} enablePan={!following}
          minDistance={following ? 2.5 : 8} maxDistance={following ? 30 : bounds.w * 3} maxPolarAngle={following ? 1.95 : Math.PI / 2 - 0.08} />
      </Canvas>
      <div className="rail3d-labels" aria-hidden="true">
        {map.zones.map(z => <span key={z.id} ref={bind(`z-${z.id}`)} className="rail3d-zone" style={{ opacity: following ? 0 : zone === 'ALL' || zone === z.id ? 1 : 0.35 }}>{z.name}</span>)}
        {labelled.map(v => <span key={v.id} ref={bind(`v-${v.id}`)} className={`rail3d-tag ${v.status === '오류' ? 'err' : ''}`} style={following ? { opacity: 0.45 } : undefined}>{v.id}</span>)}
        <span ref={hoverTag} className="viewer3d-tag floating">{hoverPart}</span>
        <span ref={selectedTag} className="viewer3d-tag floating selected">{selectedPart}</span>
      </div>
    </div>
  );
}
