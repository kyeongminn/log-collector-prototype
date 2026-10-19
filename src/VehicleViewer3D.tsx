import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { Vector3, type Group } from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Edges, RoundedBox } from '@react-three/drei';
import { PART_NAMES, partLevel, type PartLevel, type PartName } from './partStatus';

type Vec3 = [number, number, number];
/** 재질: 색, 투명도, 금속성, 거칠기, 외곽선 표시 */
type Mat = { c: string; o?: number; m?: number; ro?: number; edge?: boolean };
type Shape = Mat & (
  | { k: 'box'; a: Vec3; p: Vec3; r?: Vec3 }
  | { k: 'rbox'; a: Vec3; p: Vec3; rad: number; r?: Vec3 }
  | { k: 'cyl'; a: [number, number]; p: Vec3; r?: Vec3; seg?: number }
  | { k: 'sph'; a: [number]; p: Vec3 }
  | { k: 'tor'; a: [number, number, number]; p: Vec3; r?: Vec3 }
);

const HALF_PI = Math.PI / 2;

// 색: 모델은 무채색만 쓴다. 문제가 있는 부품만 상태 색(LEVEL_TINT · SILENT_TINT)을 입힌다.
const ACCENT = '#5c5c5c';
const ACCENT_LT = '#8f8f8f';
const GLASS = '#bdbdbd';
const WHITE = '#eeeeee';
const RAIL = '#d4d4d4';
const RAIL_DK = '#a6a6a6';
const BLACK = '#262626';
const DARK = '#3d3d3d';
const HUB = '#f2f2f2';

// OHT 개략 모델 (첨부 이미지 참고). 단위는 대략 m 이며 실제 치수와는 다릅니다.
// 레일은 X 축 방향, 본체 앞면(열린 쪽)은 +Z 방향입니다.
const FRAME: Shape[] = [
  // 알루미늄 레일 (홈 2줄, 뒤쪽 보조 레일)
  { k: 'box', a: [2.6, 0.11, 0.34], p: [0, 1.62, 0.04], c: RAIL, m: 0.55, ro: 0.3, edge: true },
  { k: 'box', a: [2.6, 0.012, 0.006], p: [0, 1.60, 0.213], c: '#ababab', m: 0.5 },
  { k: 'box', a: [2.6, 0.012, 0.006], p: [0, 1.645, 0.213], c: '#ababab', m: 0.5 },
  { k: 'box', a: [2.6, 0.02, 0.34], p: [0, 1.555, 0.04], c: '#c6c6c6', m: 0.5 },
  { k: 'box', a: [2.6, 0.06, 0.12], p: [0, 1.56, -0.28], c: RAIL_DK, m: 0.5, ro: 0.35, edge: true },
  // 레일 아래 상부 하우징과 앞면 점검판
  { k: 'box', a: [1.36, 0.16, 0.86], p: [0, 1.47, 0], c: WHITE, edge: true },
  { k: 'box', a: [0.62, 0.2, 0.02], p: [0.12, 1.33, 0.42], c: '#d9d9d9' },
  // 오른쪽 측판, 안쪽 뒷벽 (바닥판 없음: 아래는 FOUP 이 오르내리도록 열려 있다)
  { k: 'rbox', a: [0.12, 1.02, 0.84], p: [0.62, 0.9, 0], rad: 0.03, c: WHITE },
  { k: 'box', a: [1.0, 0.95, 0.03], p: [0.06, 0.88, -0.4], c: '#cccccc' },
  // 케이블 (검은 고리)
  { k: 'tor', a: [0.13, 0.018, Math.PI], p: [-0.5, 1.48, 0.45], r: [0, 0, 0], c: BLACK, ro: 0.6 },
];

// 반투명 주황 FOUP (웨이퍼 캐리어)
const FOUP: Shape[] = [
  { k: 'rbox', a: [0.7, 0.5, 0.62], p: [0.08, 0.66, 0], rad: 0.06, c: GLASS, o: 0.4, m: 0, ro: 0.15 },
  ...Array.from({ length: 9 }, (_, i): Shape => ({ k: 'box', a: [0.6, 0.008, 0.52], p: [0.08, 0.46 + i * 0.045, 0], c: '#f5f5f5', o: 0.7 })),
  { k: 'cyl', a: [0.36, 0.02], p: [0.08, 0.41, 0], c: GLASS, o: 0.55, seg: 40 },
  { k: 'box', a: [0.26, 0.04, 0.26], p: [0.08, 0.93, 0], c: GLASS, o: 0.7 },
];

/** 노란 구동 바퀴 + 검은 모터 */
const driveUnit = (x: number): Shape[] => [
  { k: 'box', a: [0.34, 0.2, 0.28], p: [x, 1.79, -0.06], c: BLACK, ro: 0.6, edge: true },
  { k: 'cyl', a: [0.05, 0.05], p: [x - 0.1, 1.915, -0.1], c: ACCENT_LT },
  { k: 'cyl', a: [0.15, 0.1], p: [x + 0.05, 1.79, 0.15], r: [HALF_PI, 0, 0], c: ACCENT, ro: 0.45, seg: 36, edge: true },
  { k: 'cyl', a: [0.06, 0.104], p: [x + 0.05, 1.79, 0.15], r: [HALF_PI, 0, 0], c: HUB, seg: 28 },
  { k: 'cyl', a: [0.018, 0.106], p: [x + 0.05, 1.79, 0.15], r: [HALF_PI, 0, 0], c: DARK, seg: 16 },
];

/** 주황 센서 하우징 + 검은 렌즈 */
const sensor = (y: number): Shape[] => [
  { k: 'rbox', a: [0.12, 0.08, 0.07], p: [-0.6, y, 0.42], rad: 0.02, c: ACCENT_LT, ro: 0.4 },
  { k: 'sph', a: [0.032], p: [-0.6, y - 0.035, 0.445], c: BLACK, m: 0.3, ro: 0.2 },
];

/** 제어 박스 앞면 통풍구 (2열 9행) */
const vents: Shape[] = [-0.38, -0.355].flatMap(x => Array.from({ length: 9 }, (_, i): Shape => ({ k: 'box', a: [0.012, 0.022, 0.004], p: [x, 0.62 + i * 0.075, 0.421], c: BLACK })));

const PARTS: Record<PartName, { shapes: Shape[]; anchor: Vec3 }> = {
  주행부: { anchor: [0.05, 2.08, 0.15], shapes: [...driveUnit(-0.42), ...driveUnit(0.42)] },
  승강부: {
    anchor: [0.62, 1.25, 0.45],
    shapes: [
      { k: 'box', a: [0.78, 0.17, 0.66], p: [0.06, 1.25, -0.02], c: '#e6e6e6', edge: true },
      { k: 'cyl', a: [0.075, 0.22], p: [0.47, 1.2, 0.3], r: [HALF_PI, 0, 0], c: DARK, seg: 28 },
      { k: 'box', a: [0.09, 0.36, 0.008], p: [0.12, 1.0, 0.33], c: '#f7f7f7', edge: true },
      { k: 'box', a: [0.34, 0.07, 0.008], p: [0.12, 1.15, 0.333], c: '#f7f7f7', edge: true },
    ],
  },
  그리퍼: {
    anchor: [0.08, 1.04, 0.5],
    shapes: [
      { k: 'box', a: [0.6, 0.045, 0.52], p: [0.08, 1.02, 0], c: '#d0d0d0', edge: true },
      { k: 'box', a: [0.05, 0.08, 0.32], p: [-0.05, 0.97, 0], c: DARK },
      { k: 'box', a: [0.05, 0.08, 0.32], p: [0.21, 0.97, 0], c: DARK },
    ],
  },
  센서: { anchor: [-0.6, 1.36, 0.5], shapes: [...sensor(1.28), ...sensor(0.44)] },
  '통신 모듈': {
    anchor: [0.05, 1.45, 0.5],
    shapes: [
      { k: 'box', a: [0.14, 0.07, 0.02], p: [0, 1.35, 0.435], c: BLACK, edge: true },
      { k: 'box', a: [0.03, 0.025, 0.01], p: [-0.03, 1.35, 0.447], c: ACCENT_LT },
      { k: 'box', a: [0.06, 0.035, 0.01], p: [0.3, 1.36, 0.435], c: BLACK },
    ],
  },
  제어부: {
    anchor: [-0.5, 1.5, 0.45],
    shapes: [
      { k: 'rbox', a: [0.36, 1.08, 0.84], p: [-0.5, 0.9, 0], rad: 0.035, c: WHITE },
      { k: 'box', a: [0.13, 0.15, 0.01], p: [-0.6, 0.95, 0.425], c: ACCENT },
      { k: 'box', a: [0.105, 0.125, 0.012], p: [-0.6, 0.95, 0.426], c: '#2e2e2e', m: 0.3, ro: 0.2 },
      { k: 'cyl', a: [0.045, 0.012], p: [-0.6, 0.72, 0.424], r: [HALF_PI, 0, 0], c: HUB },
      { k: 'cyl', a: [0.028, 0.03], p: [-0.6, 0.72, 0.44], r: [HALF_PI, 0, 0], c: ACCENT },
      { k: 'box', a: [0.025, 0.035, 0.01], p: [-0.63, 1.12, 0.424], c: ACCENT },
      { k: 'box', a: [0.03, 0.05, 0.008], p: [-0.66, 0.56, 0.424], c: BLACK },
      { k: 'box', a: [0.025, 0.04, 0.008], p: [-0.4, 0.5, 0.424], c: BLACK },
      { k: 'box', a: [0.2, 0.03, 0.006], p: [-0.55, 0.42, 0.424], c: ACCENT_LT },
      ...vents,
    ],
  },
};

const LEVEL_TINT: Record<PartLevel, string | null> = { 정상: null, 경고: '#d68a1c', 오류: '#d14545' };
/** 무수신 차량의 해당 부품 색 (레일 맵 범례의 무수신 색과 같다) */
const SILENT_TINT = '#8e7cc3';
/** 정상 부품 색 (부품 목록의 정상 표시와 같은 초록). 마우스를 올리거나 선택했을 때만 보인다 */
const OK_TINT = '#53877d';

function ShapeMesh({ s, emissive, intensity, edge, edgeOpacity }: { s: Shape; emissive: string; intensity: number; edge: string; edgeOpacity: number }) {
  const translucent = s.o !== undefined && s.o < 1;
  const material = (
    <meshStandardMaterial color={s.c} emissive={emissive} emissiveIntensity={intensity} roughness={s.ro ?? 0.5} metalness={s.m ?? 0.1}
      transparent={translucent} opacity={s.o ?? 1} depthWrite={!translucent} />
  );
  const edges = s.edge ? <Edges threshold={20} color={edge} transparent opacity={edgeOpacity} /> : null;
  const rot = 'r' in s ? s.r : undefined;
  if (s.k === 'rbox') {
    return <RoundedBox args={s.a} radius={s.rad} smoothness={3} position={s.p} rotation={rot}>{material}</RoundedBox>;
  }
  return (
    <mesh position={s.p} rotation={rot}>
      {s.k === 'box' && <boxGeometry args={s.a} />}
      {s.k === 'cyl' && <cylinderGeometry args={[s.a[0], s.a[0], s.a[1], s.seg ?? 24]} />}
      {s.k === 'sph' && <sphereGeometry args={[s.a[0], 20, 14]} />}
      {s.k === 'tor' && <torusGeometry args={[s.a[0], s.a[1], 10, 32, s.a[2]]} />}
      {material}
      {edges}
    </mesh>
  );
}

function StaticGroup({ shapes }: { shapes: Shape[] }) {
  return <group>{shapes.map((s, i) => <ShapeMesh key={i} s={s} emissive="#000000" intensity={0} edge="#949494" edgeOpacity={0.18} />)}</group>;
}

function PartGroup({ name, level, silent, selected, hovered, onSelect, onHover }: {
  name: PartName; level: PartLevel; silent: boolean; selected: boolean; hovered: boolean;
  onSelect: (p: PartName) => void; onHover: (p: PartName | null) => void;
}) {
  // 모델은 무채색. 문제가 있는 부품(경고·오류·무수신)은 늘 상태 색으로, 정상 부품은 마우스를 올리거나 선택했을 때만 정상 색으로 칠한다.
  const active = hovered || selected;
  const tint = level === '정상' ? (active ? OK_TINT : null) : silent ? SILENT_TINT : LEVEL_TINT[level];
  const emissive = tint ?? '#000000';
  const intensity = tint ? (active ? 0.62 : 0.45) : 0;
  const edge = selected ? '#2e2e2e' : tint ?? '#5e5e5e';
  const edgeOpacity = tint || selected ? 1 : 0.25;
  return (
    <group
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.delta <= 4) onSelect(name); }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(name); }}
      onPointerOut={() => onHover(null)}
    >
      {PARTS[name].shapes.map((s, i) => <ShapeMesh key={i} s={s} emissive={emissive} intensity={intensity} edge={edge} edgeOpacity={edgeOpacity} />)}
    </group>
  );
}

/** 모델 좌표에서 레일 중심 높이. 레일 맵에 올릴 때 이 높이를 맵 레일 높이에 맞춘다. */
export const MODEL_RAIL_Y = 1.62;
/** FRAME 앞쪽의 레일 조각 수. 레일 맵에서는 맵 레일을 쓰므로 빼고 그린다. */
const RAIL_SHAPES = 5;

// 부품 위치(모델 좌표)를 화면 좌표로 투영해 캔버스 위의 이름표를 따라다니게 한다.
function TagTracker({ el, anchor, obj }: { el: RefObject<HTMLSpanElement | null>; anchor: Vec3 | null; obj: RefObject<Group | null> }) {
  const v = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    const node = el.current;
    if (!node) return;
    if (!anchor || !obj.current) { node.style.visibility = 'hidden'; return; }
    v.current.set(...anchor).applyMatrix4(obj.current.matrixWorld).project(camera);
    const x = ((v.current.x + 1) / 2) * size.width;
    const y = ((1 - v.current.y) / 2) * size.height;
    node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    node.style.visibility = v.current.z < 1 ? 'visible' : 'hidden';
  });
  return null;
}

type ModelProps = {
  vehicle: { id: string; status: string; part: string };
  part: string;
  onPart: (p: PartName) => void;
  /** 부품 위에 마우스를 올리거나 뗄 때 (자동 회전 일시 정지용) */
  onHover?: (p: PartName | null) => void;
  /** 선택·호버 부품 이름표로 쓸 HTML 요소 */
  tags?: { hover: RefObject<HTMLSpanElement | null>; selected: RefObject<HTMLSpanElement | null> };
  /** 모델 자체의 레일 조각을 그릴지 (레일 맵 위에서는 그리지 않는다) */
  rail?: boolean;
};

/** 부품을 고를 수 있는 OHT 상세 모델. Canvas 안에 놓는다. 원점은 바닥(차량 아래) 기준이며 레일은 X 축 방향이다. */
export const VehicleModel = memo(function VehicleModel({ vehicle, part, onPart, onHover, tags, rail = false }: ModelProps) {
  const [hovered, setHovered] = useState<PartName | null>(null);
  const root = useRef<Group>(null);
  const selectedPart = PART_NAMES.includes(part as PartName) ? (part as PartName) : null;
  const hoverPart = hovered && hovered !== selectedPart ? hovered : null;
  const hoverCb = useRef(onHover);
  hoverCb.current = onHover;

  useEffect(() => {
    hoverCb.current?.(hovered);
    document.body.style.cursor = hovered ? 'pointer' : '';
  }, [hovered]);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return (
    <group ref={root}>
      <StaticGroup shapes={rail ? FRAME : FRAME.slice(RAIL_SHAPES)} />
      <StaticGroup shapes={FOUP} />
      {PART_NAMES.map(p => (
        <PartGroup key={p} name={p} level={partLevel(vehicle, p)} silent={vehicle.status === '무수신'} selected={part === p} hovered={hovered === p}
          onSelect={onPart} onHover={h => setHovered(cur => (h === null && cur !== p ? cur : h))} />
      ))}
      {tags && <>
        <TagTracker el={tags.selected} anchor={selectedPart && PARTS[selectedPart].anchor} obj={root} />
        <TagTracker el={tags.hover} anchor={hoverPart && PARTS[hoverPart].anchor} obj={root} />
      </>}
    </group>
  );
});
