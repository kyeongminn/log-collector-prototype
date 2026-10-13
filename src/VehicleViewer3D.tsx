import { useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Vector3 } from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, OrbitControls } from '@react-three/drei';
import { PART_NAMES, partLevel, type PartLevel, type PartName } from './partStatus';

type Vec3 = [number, number, number];
type Shape =
  | { k: 'box'; a: Vec3; p: Vec3; c: string; o?: number }
  | { k: 'cyl'; a: [number, number]; p: Vec3; r?: Vec3; c: string }
  | { k: 'sph'; a: [number]; p: Vec3; c: string };

const HALF_PI = Math.PI / 2;

// 단순화한 OHT 개략 모델. 단위는 대략 m 이며 실제 치수와는 다릅니다.
const FRAME: Shape[] = [
  { k: 'box', a: [2.4, 0.18, 0.42], p: [0, 1.72, 0], c: '#d3dae3' },
  { k: 'box', a: [2.4, 0.04, 0.1], p: [0, 1.61, 0.16], c: '#c2cbd6' },
  { k: 'box', a: [2.4, 0.04, 0.1], p: [0, 1.61, -0.16], c: '#c2cbd6' },
  { k: 'box', a: [0.12, 0.22, 0.12], p: [0, 1.29, 0], c: '#9aa7b6' },
  { k: 'box', a: [1.3, 0.08, 0.78], p: [0, 1.16, 0], c: '#e7ecf1' },
  { k: 'box', a: [1.3, 1.12, 0.05], p: [0, 0.61, 0.37], c: '#eef2f6' },
  { k: 'box', a: [1.3, 1.12, 0.05], p: [0, 0.61, -0.37], c: '#eef2f6' },
  { k: 'box', a: [1.3, 0.05, 0.1], p: [0, 0.07, 0.37], c: '#cbd3dc' },
  { k: 'box', a: [1.3, 0.05, 0.1], p: [0, 0.07, -0.37], c: '#cbd3dc' },
];

const FOUP: Shape[] = [
  { k: 'box', a: [0.6, 0.36, 0.5], p: [0, 0.28, 0], c: '#b9c4d2', o: 0.55 },
  { k: 'box', a: [0.3, 0.04, 0.3], p: [0, 0.48, 0], c: '#a9b5c4', o: 0.7 },
];

const wheel = (x: number, z: number): Shape => ({ k: 'cyl', a: [0.09, 0.06], p: [x, 1.6, z], r: [HALF_PI, 0, 0], c: '#2e3a48' });
const belt = (x: number, z: number): Shape => ({ k: 'box', a: [0.03, 0.36, 0.012], p: [x, 0.84, z], c: '#55667a' });

const PARTS: Record<PartName, { shapes: Shape[]; anchor: Vec3 }> = {
  주행부: {
    anchor: [0, 1.95, 0],
    shapes: [
      { k: 'box', a: [0.9, 0.2, 0.24], p: [0, 1.48, 0], c: '#64748b' },
      { k: 'cyl', a: [0.075, 0.2], p: [0, 1.48, 0.2], r: [HALF_PI, 0, 0], c: '#4b5a6c' },
      wheel(0.32, 0.15), wheel(0.32, -0.15), wheel(-0.32, 0.15), wheel(-0.32, -0.15),
    ],
  },
  승강부: {
    anchor: [0.75, 1.1, 0],
    shapes: [
      { k: 'cyl', a: [0.08, 0.9], p: [0, 1.06, 0], r: [0, 0, HALF_PI], c: '#8a9bb0' },
      { k: 'box', a: [0.18, 0.14, 0.18], p: [0.52, 1.06, 0], c: '#6f8197' },
      belt(0.3, 0.2), belt(0.3, -0.2), belt(-0.3, 0.2), belt(-0.3, -0.2),
    ],
  },
  그리퍼: {
    anchor: [0, 0.75, 0.5],
    shapes: [
      { k: 'box', a: [0.72, 0.07, 0.52], p: [0, 0.63, 0], c: '#d5dce5' },
      { k: 'box', a: [0.06, 0.1, 0.36], p: [0.17, 0.55, 0], c: '#9aa9ba' },
      { k: 'box', a: [0.06, 0.1, 0.36], p: [-0.17, 0.55, 0], c: '#9aa9ba' },
    ],
  },
  센서: {
    anchor: [0.85, 0.95, 0],
    shapes: [
      { k: 'box', a: [0.06, 0.12, 0.22], p: [0.68, 0.95, 0], c: '#2c435d' },
      { k: 'cyl', a: [0.035, 0.03], p: [0.72, 0.95, 0], r: [0, 0, HALF_PI], c: '#63c1c4' },
      { k: 'box', a: [0.06, 0.08, 0.16], p: [0.68, 0.14, 0], c: '#2c435d' },
    ],
  },
  '통신 모듈': {
    anchor: [-0.45, 1.68, 0.3],
    shapes: [
      { k: 'box', a: [0.18, 0.08, 0.14], p: [-0.45, 1.24, 0.3], c: '#455d76' },
      { k: 'cyl', a: [0.012, 0.26], p: [-0.45, 1.41, 0.3], c: '#455d76' },
      { k: 'sph', a: [0.026], p: [-0.45, 1.55, 0.3], c: '#455d76' },
    ],
  },
  제어부: {
    anchor: [-0.2, 1.15, 0.6],
    shapes: [
      { k: 'box', a: [0.62, 0.42, 0.1], p: [-0.2, 0.86, 0.45], c: '#f1f4f7' },
      { k: 'box', a: [0.2, 0.1, 0.012], p: [-0.33, 0.94, 0.505], c: '#3c4b5c' },
      { k: 'box', a: [0.05, 0.05, 0.012], p: [-0.06, 0.94, 0.505], c: '#5bbf8f' },
    ],
  },
};

const LEVEL_TINT: Record<PartLevel, string | null> = { 정상: null, 경고: '#d68a1c', 오류: '#d14545' };

function ShapeMesh({ s, emissive, intensity, edge, edgeOpacity }: { s: Shape; emissive: string; intensity: number; edge: string; edgeOpacity: number }) {
  return (
    <mesh position={s.p} rotation={s.k === 'cyl' ? s.r : undefined} castShadow>
      {s.k === 'box' && <boxGeometry args={s.a} />}
      {s.k === 'cyl' && <cylinderGeometry args={[s.a[0], s.a[0], s.a[1], 28]} />}
      {s.k === 'sph' && <sphereGeometry args={[s.a[0], 20, 14]} />}
      <meshStandardMaterial
        color={s.c}
        emissive={emissive}
        emissiveIntensity={intensity}
        roughness={0.55}
        metalness={0.15}
        transparent={s.k === 'box' && s.o !== undefined}
        opacity={s.k === 'box' && s.o !== undefined ? s.o : 1}
      />
      <Edges threshold={20} color={edge} transparent opacity={edgeOpacity} />
    </mesh>
  );
}

function StaticGroup({ shapes }: { shapes: Shape[] }) {
  return <group>{shapes.map((s, i) => <ShapeMesh key={i} s={s} emissive="#000000" intensity={0} edge="#7d8ca0" edgeOpacity={0.25} />)}</group>;
}

function PartGroup({ name, level, selected, hovered, onSelect, onHover }: {
  name: PartName; level: PartLevel; selected: boolean; hovered: boolean;
  onSelect: (p: PartName) => void; onHover: (p: PartName | null) => void;
}) {
  const tint = LEVEL_TINT[level];
  // 이상 부품은 선택 여부와 관계없이 경고·오류 색을 유지하고, 선택은 파란 테두리로 표시합니다.
  const emissive = tint ?? (selected ? '#2f6fd0' : hovered ? '#5b8fd8' : '#000000');
  const intensity = tint ? (selected || hovered ? 0.55 : 0.4) : selected ? 0.45 : hovered ? 0.25 : 0;
  const edge = selected ? '#1f5fbf' : tint ?? '#56677c';
  const edgeOpacity = selected ? 1 : tint ? 0.8 : 0.35;
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

const MODEL_OFFSET_Y = -0.85;

// 부품 위치를 화면 좌표로 투영해 캔버스 위의 이름표를 따라다니게 합니다.
function TagTracker({ el, anchor }: { el: RefObject<HTMLSpanElement | null>; anchor: Vec3 | null }) {
  const v = useRef(new Vector3());
  const invalidate = useThree(st => st.invalidate);
  useEffect(() => { invalidate(); }, [anchor, invalidate]);
  useFrame(({ camera, size }) => {
    const node = el.current;
    if (!node) return;
    if (!anchor) { node.style.visibility = 'hidden'; return; }
    v.current.set(anchor[0], anchor[1] + MODEL_OFFSET_Y, anchor[2]).project(camera);
    const x = ((v.current.x + 1) / 2) * size.width;
    const y = ((1 - v.current.y) / 2) * size.height;
    node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    node.style.visibility = v.current.z < 1 ? 'visible' : 'hidden';
  });
  return null;
}

type Props = { vehicle: { id: string; status: string; part: string }; part: string; onPart: (p: PartName) => void };

export default function VehicleViewer3D({ vehicle, part, onPart }: Props) {
  const [hovered, setHovered] = useState<PartName | null>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const selectedTag = useRef<HTMLSpanElement>(null);
  const hoverTag = useRef<HTMLSpanElement>(null);
  const selectedPart = PART_NAMES.includes(part as PartName) ? (part as PartName) : null;
  const hoverPart = hovered && hovered !== selectedPart ? hovered : null;

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
    return () => { document.body.style.cursor = ''; };
  }, [hovered]);

  return (
    <div className="viewer3d">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [4.1, 2.6, 4.5], fov: 30 }}
        gl={{ antialias: true, alpha: true }}
        aria-label={`${vehicle.id} 3D 모델. 드래그하여 회전하고 부품을 클릭하여 상태를 확인합니다.`}
        onPointerMissed={() => setHovered(null)}
      >
        <ambientLight intensity={0.75} />
        <hemisphereLight args={['#ffffff', '#c9d3df', 0.6]} />
        <directionalLight position={[4, 6, 3]} intensity={1.3} />
        <directionalLight position={[-4, 2, -3]} intensity={0.45} />
        <group position={[0, MODEL_OFFSET_Y, 0]}>
          <StaticGroup shapes={FRAME} />
          <StaticGroup shapes={FOUP} />
          {PART_NAMES.map(p => (
            <PartGroup key={p} name={p} level={partLevel(vehicle, p)} selected={part === p} hovered={hovered === p} onSelect={onPart} onHover={h => setHovered(cur => (h === null && cur !== p ? cur : h))} />
          ))}
          {/* 바닥 그림자: 렌더 타깃을 쓰는 ContactShadows 는 일부 GPU·드라이버에서 검은 사각형으로 보이므로 단순한 반투명 타원을 쓴다 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} scale={[1.45, 1, 1]}>
            <circleGeometry args={[1.25, 48]} />
            <meshBasicMaterial color="#8d9bab" transparent opacity={0.16} depthWrite={false} />
          </mesh>
        </group>
        <TagTracker el={selectedTag} anchor={selectedPart && PARTS[selectedPart].anchor} />
        <TagTracker el={hoverTag} anchor={hoverPart && PARTS[hoverPart].anchor} />
        <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping minDistance={3} maxDistance={10} minPolarAngle={0} maxPolarAngle={Math.PI} target={[0, 0, 0]} />
      </Canvas>
      <span ref={hoverTag} className="viewer3d-tag floating" aria-hidden="true">{hoverPart}</span>
      <span ref={selectedTag} className="viewer3d-tag floating selected" aria-hidden="true">{selectedPart}</span>
      <span className="model-label">3D VIEW</span>
      <button className="viewer3d-reset" onClick={() => controls.current?.reset()} aria-label="시점 초기화">시점 초기화</button>
      <span className="viewer3d-hint">드래그 회전 · 휠 확대 · 부품 클릭</span>
    </div>
  );
}
