// 공용 가상 레일 맵.
//
// 시뮬레이터(ohtsim)는 차량마다 서로 다른 가상 트랙을 만들고 좌표를 남기지 않는다.
// 그래서 관제 화면에서는 모든 차량이 공유하는 레일 맵을 우리 쪽에서 정의하고,
// 로그의 노드 번호를 이 맵의 링크 위 위치로 바꿔서(resolver.ts) 표시한다.
//
// 좌표 단위는 미터(m). 링크 길이 분포는 시뮬레이터 map_stats.json 과 비슷하게 맞췄다.
//   - 직선 링크: 평균 약 1.6 m (최대 3 m)
//   - 우회전/좌회전: 반지름 1.2 m 의 1/4 원호 (약 1.9 m)
//   - 모든 루프는 시계 방향(화면 기준)으로 돈다.

export type LinkType = 'Straight' | 'RightCurve' | 'LeftCurve' | 'Uturn';
export type LinkKind = 'main' | 'bay' | 'connector';

export interface MapNode { id: number; x: number; y: number }
export interface MapLink {
  id: number;
  from: number;
  to: number;
  type: LinkType;
  kind: LinkKind;
  length: number;
  /** SVG path (m 단위 좌표) */
  d: string;
  /** 원호 링크의 중심과 반지름, 회전 방향(+1 시계) */
  arc?: { cx: number; cy: number; r: number; a0: number; a1: number };
}
export interface Station { id: string; bay: string; x: number; y: number; linkId: number }
export interface Zone { id: string; name: string; desc: string; x: number; y: number; w: number; h: number }

export interface RailMap {
  nodes: MapNode[];
  links: MapLink[];
  stations: Station[];
  zones: Zone[];
  bounds: { x: number; y: number; w: number; h: number };
  outgoing: Map<number, MapLink[]>;
  linkById: Map<number, MapLink>;
  nodeById: Map<number, MapNode>;
}

/** 레일 맵에서 확대해 보여줄 영역(m) */
export interface MapRect { x: number; y: number; w: number; h: number }

/** 확대할 영역: 기기 상세가 열려 있으면 그 차량이 속한 구역(외곽 레일이면 차량 주변), 아니면 구역 선택값. 없으면 전체 보기. */
export function focusRect(map: RailMap, zone: string, vehicle?: { area: string; x: number; y: number } | null): MapRect | null {
  const area = vehicle ? vehicle.area : zone;
  const z = map.zones.find(q => q.id === area);
  if (z) return { x: z.x, y: z.y, w: z.w, h: z.h };
  if (vehicle) return { x: vehicle.x - 12, y: vehicle.y - 3.5, w: 24, h: 7 };
  return null;
}

export interface Pose { x: number; y: number; heading: number }

/** 링크 위 진행률(0..1)에 해당하는 좌표와 진행 방향(라디안)을 돌려준다. */
export function poseOnLink(map: RailMap, link: MapLink, t: number): Pose {
  const u = Math.min(1, Math.max(0, t));
  if (link.arc) {
    const { cx, cy, r, a0, a1 } = link.arc;
    const a = a0 + (a1 - a0) * u;
    const dir = a1 > a0 ? 1 : -1;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), heading: a + dir * Math.PI / 2 };
  }
  const p = map.nodeById.get(link.from)!, q = map.nodeById.get(link.to)!;
  return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, heading: Math.atan2(q.y - p.y, q.x - p.x) };
}

const CORNER_R = 1.2;
/** 베이 진입·진출 연결 레일이 외곽 루프에 붙는 지점의 베이 밖 거리(m). 이웃 베이의 진출·진입 레일이 서로 엇갈려 교차하지 않도록 베이 사이 간격(3 m)의 절반보다 작게 둔다 */
const CONN_OFFSET = 0.5;
const STRAIGHT_LEN = 1.6;

class Builder {
  nodes: MapNode[] = [];
  links: MapLink[] = [];
  stations: Station[] = [];
  zones: Zone[] = [];
  private seed: number;
  constructor(seed: number) { this.seed = seed; }

  private rand() {
    // 결정적 난수(mulberry32): 같은 시드면 같은 맵
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  node(x: number, y: number): MapNode {
    const n = { id: this.nodes.length + 1, x: +x.toFixed(3), y: +y.toFixed(3) };
    this.nodes.push(n);
    return n;
  }

  straight(a: MapNode, b: MapNode, kind: LinkKind): MapLink {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const l: MapLink = { id: this.links.length + 1, from: a.id, to: b.id, type: 'Straight', kind, length: +length.toFixed(3), d: `M${a.x} ${a.y}L${b.x} ${b.y}` };
    this.links.push(l);
    return l;
  }

  /** a 에서 b 까지 직선을 약 STRAIGHT_LEN 간격으로 나눠 여러 링크로 만든다. 중간 노드를 돌려준다. */
  run(a: MapNode, b: MapNode, kind: LinkKind): MapNode[] {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / STRAIGHT_LEN));
    const nodes = [a];
    let prev = a;
    for (let i = 1; i < n; i++) {
      // 간격을 조금씩 흔들어 실제 맵처럼 불규칙하게
      const t = (i + (this.rand() - 0.5) * 0.35) / n;
      const m = this.node(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      this.straight(prev, m, kind);
      nodes.push(m);
      prev = m;
    }
    this.straight(prev, b, kind);
    nodes.push(b);
    return nodes;
  }

  /** 중심 (cx,cy), 반지름 r, 각도 a0 → a1 의 원호 링크. 화면 좌표계에서 각도 증가 = 시계 방향 */
  arc(a: MapNode, b: MapNode, cx: number, cy: number, r: number, a0: number, a1: number, kind: LinkKind): MapLink {
    const sweep = a1 > a0 ? 1 : 0;              // 1 = 시계 방향(우회전)
    const length = Math.abs(a1 - a0) * r;
    const type: LinkType = Math.abs(a1 - a0) > Math.PI * 0.75 ? 'Uturn' : sweep ? 'RightCurve' : 'LeftCurve';
    const l: MapLink = { id: this.links.length + 1, from: a.id, to: b.id, type, kind, length: +length.toFixed(3), d: `M${a.x} ${a.y}A${r} ${r} 0 0 ${sweep} ${b.x} ${b.y}`, arc: { cx, cy, r, a0, a1 } };
    this.links.push(l);
    return l;
  }

  /**
   * 모서리가 둥근 시계 방향 사각 루프. 변마다 노드 목록을 돌려준다.
   * top: 왼→오, right: 위→아래, bottom: 오→왼, left: 아래→위
   */
  loop(x: number, y: number, w: number, h: number, kind: LinkKind) {
    const r = CORNER_R;
    const tl0 = this.node(x + r, y), tr0 = this.node(x + w - r, y);
    const tr1 = this.node(x + w, y + r), br1 = this.node(x + w, y + h - r);
    const br0 = this.node(x + w - r, y + h), bl0 = this.node(x + r, y + h);
    const bl1 = this.node(x, y + h - r), tl1 = this.node(x, y + r);
    const top = this.run(tl0, tr0, kind);
    this.arc(tr0, tr1, x + w - r, y + r, r, -Math.PI / 2, 0, kind);
    const right = this.run(tr1, br1, kind);
    this.arc(br1, br0, x + w - r, y + h - r, r, 0, Math.PI / 2, kind);
    const bottom = this.run(br0, bl0, kind);
    this.arc(bl0, bl1, x + r, y + h - r, r, Math.PI / 2, Math.PI, kind);
    const left = this.run(bl1, tl1, kind);
    this.arc(tl1, tl0, x + r, y + r, r, Math.PI, Math.PI * 1.5, kind);
    return { top, right, bottom, left };
  }

  nearest(nodes: MapNode[], x: number) {
    return nodes.reduce((best, n) => (Math.abs(n.x - x) < Math.abs(best.x - x) ? n : best), nodes[0]);
  }
}

export interface MapOptions {
  seed?: number;
  /** 베이 열 수 (위·아래 두 줄에 같은 수) */
  baysPerRow?: number;
  bayW?: number;
  bayH?: number;
}

/** OHT 30대 규모의 가상 FAB 레이아웃: 외곽 인터베이 루프 1개 + 베이 루프 6개(2줄 × 3) */
export function buildRailMap(opts: MapOptions = {}): RailMap {
  const { seed = 20261013, baysPerRow = 3, bayW = 24, bayH = 7 } = opts;
  const b = new Builder(seed);
  const gap = 3;                    // 베이 사이 간격
  const margin = 6;                 // 외곽 루프와 베이 사이
  const W = margin * 2 + baysPerRow * bayW + (baysPerRow - 1) * gap;
  const H = margin * 2 + bayH * 2 + 14;   // 가운데 통로 14 m

  const main = b.loop(0, 0, W, H, 'main');
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  const descs = ['PHOTO', 'ETCH', 'DIFFUSION', 'THIN FILM', 'CMP', 'STOCKER'];

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < baysPerRow; col++) {
      const i = row * baysPerRow + col;
      const bx = margin + col * (bayW + gap);
      const by = row === 0 ? margin : H - margin - bayH;
      const bay = b.loop(bx, by, bayW, bayH, 'bay');
      const id = `BAY-${names[i]}`;
      b.zones.push({ id, name: `${names[i]} 베이`, desc: descs[i] ?? 'PROCESS', x: bx, y: by, w: bayW, h: bayH });

      // 외곽 루프와 베이를 잇는 분기(진입)·합류(진출) 링크
      if (row === 0) {
        // 위쪽 베이: 외곽 상단 변(왼→오)에서 베이 상단 변으로 들어가고, 베이 상단 변 끝에서 외곽으로 나간다
        const entryMain = b.nearest(main.top, bx - CONN_OFFSET);
        const entryBay = bay.top[0];
        b.run(entryMain, entryBay, 'connector');
        const exitBay = bay.top[bay.top.length - 1];
        const exitMain = b.nearest(main.top, bx + bayW + CONN_OFFSET);
        b.run(exitBay, exitMain, 'connector');
      } else {
        // 아래쪽 베이: 외곽 하단 변(오→왼)에서 베이 하단 변으로 들어간다
        const entryMain = b.nearest(main.bottom, bx + bayW + CONN_OFFSET);
        const entryBay = bay.bottom[0];
        b.run(entryMain, entryBay, 'connector');
        const exitBay = bay.bottom[bay.bottom.length - 1];
        const exitMain = b.nearest(main.bottom, bx - CONN_OFFSET);
        b.run(exitBay, exitMain, 'connector');
      }

      // 베이 안쪽 양 변을 따라 로드포트(장비 접속 지점)
      const inner = row === 0 ? bay.bottom : bay.top;      // 가운데 통로 쪽 변
      const outer = row === 0 ? bay.top : bay.bottom;
      let k = 1;
      for (const side of [outer, inner]) {
        for (let j = 2; j < side.length - 2; j += 2) {
          const n = side[j];
          const link = b.links.find(l => l.from === n.id)!;
          const dy = side === bay.top ? 0.9 : -0.9;         // 루프 안쪽으로
          b.stations.push({ id: `${names[i]}${String(k++).padStart(2, '0')}`, bay: id, x: n.x, y: n.y + dy, linkId: link.id });
        }
      }
    }
  }

  // 가운데 통로를 가로지르는 지름길 두 가닥. 시계 방향 흐름을 깨지 않도록
  // 왼쪽 변(아래→위) 중간에서 오른쪽 변으로, 오른쪽 변(위→아래) 중간에서 왼쪽 변으로 간다.
  // 끝은 반대편 변의 기존 노드에 바로 합류하며(완만한 사선), 진행 방향이 뒤로 가지 않게 아래·위로 조금 비껴 잇는다.
  const midY = H / 2;
  const nearestY = (nodes: MapNode[], y: number) => nodes.reduce((p, n) => (Math.abs(n.y - y) < Math.abs(p.y - y) ? n : p), nodes[0]);
  const leftMid = nearestY(main.left, midY + 1);
  const rightMid = nearestY(main.right, midY - 1);
  b.run(leftMid, nearestY(main.right.filter(n => n.y > leftMid.y + 1), leftMid.y + 1.5), 'main');
  b.run(rightMid, nearestY(main.left.filter(n => n.y < rightMid.y - 1), rightMid.y - 1.5), 'main');

  const outgoing = new Map<number, MapLink[]>();
  for (const l of b.links) {
    if (!outgoing.has(l.from)) outgoing.set(l.from, []);
    outgoing.get(l.from)!.push(l);
  }
  return {
    nodes: b.nodes,
    links: b.links,
    stations: b.stations,
    zones: b.zones,
    bounds: { x: -2, y: -2, w: W + 4, h: H + 4 },
    outgoing,
    linkById: new Map(b.links.map(l => [l.id, l])),
    nodeById: new Map(b.nodes.map(n => [n.id, n])),
  };
}

/** 구역 판정: 좌표가 어느 베이 안(또는 근처)인지. 베이 밖이면 'MAIN'. */
export function zoneAt(map: RailMap, x: number, y: number): string {
  for (const z of map.zones) {
    if (x >= z.x - 1 && x <= z.x + z.w + 1 && y >= z.y - 1 && y <= z.y + z.h + 1) return z.id;
  }
  return 'MAIN';
}
