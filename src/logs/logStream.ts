// 시뮬레이터(ohtsim)와 같은 형식의 로그 줄을 만들어 보관하는 스트림.
//
// 줄의 골격은 두 가지다.
//   OHTHandlerLogger: [YYYY-MM-DD HH:MM:SS.ffff],[카테고리],[INFORMATION],[순번],[msg => 메시지]
//   UILogger:         YYYY-MM-DD HH:MM:SS,fff [스레드] INFO 카테고리 - 메시지
// 메시지 본문 문구는 모두 messages.ts 에 있다. 이 파일은 값만 계산해서 messages.ts 의 함수를 부른다.
// 데모에서는 DemoFleet 의 이벤트(route/go/status/arrived)를 받아 해당 줄을 생성한다.
// 실제 로그가 연결되면 생성 대신 수집된 줄을 push() 로 넣으면 된다.
//
// 표시 부담을 줄이기 위해 내용 없는 반복 줄은 만들지 않는다. 상태 보고는 차량당 3초에 1줄만 남긴다.
//
// 이상 판정(ALT-605): 원문 레벨이 모두 INFORMATION/INFO 이므로, 줄을 만들 때 해당하는 규칙 ID 를 붙여 등급을 매긴다.

import type { LogEvent } from '../map/logParser';
import type { DemoStatus } from '../map/demoFleet';
import type { PartName } from '../partStatus';
import { AREA, CONFIG_LINES, IO_GROUPS, LINE_NAME, M, RULE_DESC, type GoInfo } from './messages';

export type Category = 'SEQ_INFO' | 'API_CALL_INFO' | 'PARTS_INFO' | 'WMX' | 'APP' | 'OHT' | 'OPS' | 'NET' | 'IO';
export type Logger = 'OHTHandlerLogger' | 'UILogger';
export type Level = 'INFORMATION' | 'INFO' | 'ERROR';
export type Severity = 'ERROR' | 'WARN' | 'INFO';

export const CATEGORIES: Category[] = ['SEQ_INFO', 'API_CALL_INFO', 'PARTS_INFO', 'WMX', 'APP', 'OHT', 'OPS', 'NET', 'IO'];
const HANDLER = new Set<Category>(['SEQ_INFO', 'API_CALL_INFO', 'PARTS_INFO', 'WMX']);
export const SEVERITY_LABEL: Record<Severity, string> = { ERROR: '이상', WARN: '주의', INFO: '정상' };
export const SEVERITY_OPTIONS = ['전체 판정', '이상', '주의', '정상'];

/** 실제 장비 기준 차량 1대·시간당 줄 수 (가장 바쁜 시간대). 유입량·추이 추정에 쓴다. */
export const LINES_PER_HOUR: Record<Category, number> = { OHT: 79216, SEQ_INFO: 69189, APP: 40202, OPS: 22628, NET: 2465, API_CALL_INFO: 1792, PARTS_INFO: 3, WMX: 4, IO: 4 };
/** 실제 장비 기준 카테고리별 평균 줄 길이 (바이트, CRLF 포함) */
export const BYTES_PER_LINE: Record<Category, number> = { OHT: 67, SEQ_INFO: 333, APP: 122, OPS: 118, NET: 114, API_CALL_INFO: 321, PARTS_INFO: 110, WMX: 112, IO: 93 };
/** 실측 압축비 범위 (zstd 기준, 명세 9~15배) */
export const COMPRESSION_RATIO = { min: 9, max: 15 };
/** Hot 보관 기간 (STO-405). Cold 전환 후 삭제까지의 M일은 기업 확정 대기 */
export const HOT_RETENTION_DAYS = 30;

// ---------------------------------------------------------------- 이상 탐지 규칙 (ALT-605)

export interface Rule { id: string; name: string; desc: string; severity: Severity; source: string }

export const RULES: Rule[] = [
  { id: 'motion_fail', name: '모션 명령 실패', desc: RULE_DESC.motion_fail, severity: 'ERROR', source: 'WMX' },
  { id: 'restart', name: '재기동', desc: RULE_DESC.restart, severity: 'ERROR', source: 'PARTS_INFO · WMX' },
  { id: 'resync_burst', name: '위치 보정 급증', desc: RULE_DESC.resync_burst, severity: 'WARN', source: 'SEQ_INFO' },
  { id: 'net_degraded', name: '무선 품질 저하', desc: RULE_DESC.net_degraded, severity: 'WARN', source: 'NET' },
  { id: 'pass_missing', name: '통과 확인 누락', desc: RULE_DESC.pass_missing, severity: 'WARN', source: 'APP' },
  { id: 'lidar_stop', name: '장애물 감지 정지', desc: RULE_DESC.lidar_stop, severity: 'WARN', source: 'SEQ_INFO' },
  { id: 'slip_skip', name: '슬립 보정 건너뜀', desc: RULE_DESC.slip_skip, severity: 'WARN', source: 'SEQ_INFO' },
];

export interface LogLine {
  id: number;
  time: number;              // epoch ms
  vehicle: string;
  logger: Logger;
  cat: Category;
  level: Level;
  thread?: string;           // UILogger
  seq?: number;              // OHTHandlerLogger
  msg: string;
  raw: string;               // 파일에 기록되는 줄 그대로
  file: string;              // 기록 파일 경로 (차량 폴더 기준)
  severity: Severity;        // 규칙으로 판정한 등급 (원문에는 없음)
  reason?: string;           // 판정 사유
  rule?: string;             // 적용된 규칙 ID
  part: PartName;            // 카테고리·메시지로 추정한 관련 부품
}

// ---------------------------------------------------------------- 형식

const pad = (n: number | string, w: number) => String(n).padStart(w, '0');

function parts(ms: number) {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  const time = `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`;
  return { date, time, ms: d.getMilliseconds(), ymd: `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`, hh: pad(d.getHours(), 2) };
}

/** 핸들러 계열 시각: 소수점 아래 4자리. 데모는 ms 해상도라 마지막 자리는 순번으로 채운다. */
export function fmtHandlerTs(ms: number, sub = 0) { const p = parts(ms); return `${p.date} ${p.time}.${pad(p.ms * 10 + (sub % 10), 4)}`; }
/** UI 계열 시각: 쉼표 뒤 밀리초 3자리 */
export function fmtUiTs(ms: number) { const p = parts(ms); return `${p.date} ${p.time},${pad(p.ms, 3)}`; }
/** 표에 보여줄 시각 */
export function fmtClock(ms: number) { const p = parts(ms); return `${p.time}.${pad(p.ms, 3)}`; }
export function fmtDate(ms: number) { const p = parts(ms); return `${p.date} ${p.time}`; }
export function fmtAgo(ms: number) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 ${s % 60}초 전` : `${Math.floor(s / 3600)}시간 전`; }

export function fileFor(vehicle: string, cat: Category, ms: number) {
  const p = parts(ms);
  return HANDLER.has(cat) ? `${vehicle}/OHTHandlerLogger/${cat}/${p.ymd}_${p.hh}_${cat}.txt` : `${vehicle}/UILogger/${cat}_${p.ymd}_${p.hh}.log`;
}

// ---------------------------------------------------------------- 판정·부품

/** 규칙 ID 별 기본 등급·사유. 반복·급증처럼 맥락이 필요한 경우는 push 시점에 등급과 사유를 따로 넘긴다. */
const RULE_DEFAULT: Record<string, { severity: Severity; reason: string }> = {
  motion_fail: { severity: 'ERROR', reason: '주행 모션 명령 실패' },
  restart: { severity: 'WARN', reason: '프로세스 기동' },
  lidar_stop: { severity: 'WARN', reason: '장애물 감지 정지' },
  slip_skip: { severity: 'WARN', reason: '슬립 보정 건너뜀' },
  net_degraded: { severity: 'WARN', reason: '무선 품질 저하' },
  resync_burst: { severity: 'WARN', reason: '위치 보정 급증' },
  pass_missing: { severity: 'WARN', reason: '통과 확인 누락' },
};

/** 규칙 패널에서 끈 규칙은 정상으로 본다. */
export function effectiveSeverity(l: LogLine, disabled?: Set<string>): Severity {
  return l.rule && disabled?.has(l.rule) ? 'INFO' : l.severity;
}

/** 카테고리 기준 관련 부품. 이재 센서·장애물 정지처럼 더 구체적인 경우는 push 시점에 넘긴다. */
function defaultPart(cat: Category): PartName {
  switch (cat) {
    case 'IO': return '센서';
    case 'NET': return '통신 모듈';
    case 'APP': case 'PARTS_INFO': return '제어부';
    default: return '주행부';
  }
}

// ---------------------------------------------------------------- 필터

export interface LogFilter {
  part?: string;
  errorsOnly?: boolean;
  includeWarn?: boolean;
  severity?: string;        // SEVERITY_OPTIONS 중 하나
  category?: string;        // '전체 카테고리' 또는 Category
  vehicle?: string;         // '전체 차량' 또는 차량 ID
  onlyVehicle?: string;     // 선택 차량 탭
  search?: string;
  from?: number;            // epoch ms (포함)
  to?: number;              // epoch ms (포함)
  disabledRules?: Set<string>;
}

export function filterLogs(lines: LogLine[], f: LogFilter): LogLine[] {
  const q = (f.search ?? '').trim().toLowerCase();
  const sev = f.severity && f.severity !== '전체 판정' ? (Object.keys(SEVERITY_LABEL) as Severity[]).find(k => SEVERITY_LABEL[k] === f.severity) : undefined;
  return lines.filter(l => {
    const s = effectiveSeverity(l, f.disabledRules);
    return (!f.part || l.part === f.part) &&
      (!f.errorsOnly || s === 'ERROR' || (f.includeWarn && s === 'WARN')) &&
      (!sev || s === sev) &&
      (!f.category || f.category === '전체 카테고리' || l.cat === f.category) &&
      (!f.vehicle || f.vehicle === '전체 차량' || l.vehicle === f.vehicle) &&
      (!f.onlyVehicle || l.vehicle === f.onlyVehicle) &&
      (f.from === undefined || l.time >= f.from) && (f.to === undefined || l.time <= f.to) &&
      (!q || l.raw.toLowerCase().includes(q) || l.vehicle.toLowerCase().includes(q));
  });
}

// ---------------------------------------------------------------- 생성

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const pick = <T,>(rng: () => number, arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
const ri = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const OPS_BASE = 3758096384;
const DETECT: Record<string, number> = { Straight: 16, RightCurve: 20, LeftCurve: 19, Uturn: 19 };
const NET_THREADS = ['3', '11', '13', '15', '16', '17', '18'];

interface VState {
  rng: () => number;
  seq: Record<string, number>;
  sendCnt: number;
  mac: string; ip: string; ver: string; ch: number; rssi: number;
  ops: Map<number, [number, number]>; opsCur: number;
  lastCur: number | null;
  lastSend: number; nextNet: number; nextKpi: number; nextFault: number;
  restartTimes: number[];
  rejectTimes: number[];
  opsSeq: number; resyncSeq: number;
  driving: boolean;
  lastPos: number;
}

export interface VehicleInfo { id: string; status: DemoStatus; driving: boolean }

/** 분 단위 집계 (로그 추이 패널용) */
export interface MinuteBucket { minute: number; cats: Record<Category, number>; err: number; warn: number }

interface PushOpts { thread?: string; level?: Level; severity?: Severity; reason?: string; rule?: string; part?: PartName }

export class LogStream {
  private buf: LogLine[] = [];
  private cache: LogLine[] = [];
  private cacheVersion = -1;
  private nextId = 1;
  private states = new Map<string, VState>();
  private pending: Array<{ at: number; fn: () => void }> = [];
  private seen = new Map<string, number>();
  private buckets = new Map<number, MinuteBucket>();
  readonly startedAt = Date.now();
  version = 0;
  constructor(readonly max = 8000) {}

  /** 최신 줄이 앞에 오는 배열. 바뀐 게 없으면 같은 배열을 돌려준다. */
  snapshot(): LogLine[] {
    if (this.cacheVersion !== this.version) { this.cache = [...this.buf].reverse(); this.cacheVersion = this.version; }
    return this.cache;
  }

  /** 차량별 마지막 로그 수신 시각 (무수신 판정용) */
  lastSeen(vehicle: string): number | undefined { return this.seen.get(vehicle); }

  /** 분 단위 집계. 없는 분은 undefined */
  bucket(minute: number): MinuteBucket | undefined { return this.buckets.get(minute); }

  /** 완성된 줄 하나를 보관한다. 외부에서 수집한 줄을 넣을 때도 이 메서드를 쓴다. */
  push(vehicle: string, cat: Category, time: number, msg: string, opts: PushOpts = {}) {
    const st = this.state(vehicle);
    const handler = HANDLER.has(cat);
    const level: Level = opts.level ?? (handler ? 'INFORMATION' : 'INFO');
    const id = this.nextId++;
    let seq: number | undefined, thread: string | undefined, raw: string;
    if (handler) {
      seq = st.seq[cat] = (st.seq[cat] ?? 0);
      st.seq[cat]++;
      raw = `[${fmtHandlerTs(time, id)}],[${cat}],[${level}],[${seq}],[msg => ${msg}]`;
    } else {
      thread = opts.thread ?? '1';
      raw = `${fmtUiTs(time)} [${thread}] ${level} ${cat} - ${msg}`;
    }
    const base = opts.rule ? RULE_DEFAULT[opts.rule] : undefined;
    const line: LogLine = {
      id, time, vehicle, logger: handler ? 'OHTHandlerLogger' : 'UILogger', cat, level, thread, seq, msg, raw, file: fileFor(vehicle, cat, time),
      severity: opts.severity ?? base?.severity ?? 'INFO', reason: opts.reason ?? base?.reason, rule: opts.rule, part: opts.part ?? defaultPart(cat),
    };
    this.buf.push(line);
    if (this.buf.length > this.max) this.buf.splice(0, this.buf.length - this.max);
    this.seen.set(vehicle, Math.max(this.seen.get(vehicle) ?? 0, time));
    const minute = Math.floor(time / 60000);
    let b = this.buckets.get(minute);
    if (!b) {
      b = { minute, cats: { SEQ_INFO: 0, API_CALL_INFO: 0, PARTS_INFO: 0, WMX: 0, APP: 0, OHT: 0, OPS: 0, NET: 0, IO: 0 }, err: 0, warn: 0 };
      this.buckets.set(minute, b);
      if (this.buckets.size > 1500) this.buckets.delete(Math.min(...this.buckets.keys()));
    }
    b.cats[cat]++;
    if (line.severity === 'ERROR') b.err++; else if (line.severity === 'WARN') b.warn++;
    this.version++;
    return line;
  }

  /** 나중 시각에 실행할 작업 (시간을 두고 이어지는 로그 묶음용) */
  private later(at: number, fn: () => void) { this.pending.push({ at, fn }); }

  private state(id: string): VState {
    let s = this.states.get(id);
    if (!s) {
      const rng = mulberry(hash(id));
      s = {
        rng, seq: { SEQ_INFO: ri(rng, 100000, 900000), API_CALL_INFO: ri(rng, 1000, 90000), PARTS_INFO: 0, WMX: 0 }, sendCnt: ri(rng, 1, 99),
        mac: '02:' + [0, 0, 0, 0, 0].map(() => pad(ri(rng, 0, 255).toString(16).toUpperCase(), 2)).join(':'),
        ip: `10.20.${ri(rng, 0, 9)}.${ri(rng, 2, 250)}`, ver: `${ri(rng, 1, 3)}.${ri(rng, 0, 9)}.${ri(rng, 0, 99)}`, ch: pick(rng, [36, 40, 44, 48, 149, 153]), rssi: ri(rng, -58, -45),
        ops: new Map(), opsCur: OPS_BASE + ri(rng, 0, 50000), lastCur: null,
        lastSend: 0, nextNet: Date.now() + rng() * 2000, nextKpi: Date.now() + rng() * 5000, nextFault: Date.now() + 1000 + rng() * 3000,
        restartTimes: [], rejectTimes: [], opsSeq: ri(rng, 900000, 1000000), resyncSeq: ri(rng, 100000, 160000), driving: false, lastPos: ri(rng, 2000, 30000),
      };
      this.states.set(id, s);
    }
    return s;
  }

  /** 노드의 위치 마크(메인·서브 ID와 오프셋). 처음 보는 노드는 새로 배정한다. */
  private ops(st: VState, node: number): { m: [number, number]; s: [number, number] } {
    let m = st.ops.get(node);
    if (!m) { st.opsCur += pick(st.rng, [1, 1, 1, 2, 3, 7]); m = [st.opsCur, ri(st.rng, 30, 836)]; st.ops.set(node, m); }
    return { m, s: [m[0] - 1, ri(st.rng, -2009, 1664)] };
  }

  /** 위치 보정 줄. 2초 안에 10건 이상이면 '위치 보정 급증'으로 판정한다. */
  private pushReject(vehicle: string, st: VState, t: number, resync: boolean) {
    const rng = st.rng;
    st.rejectTimes = st.rejectTimes.filter(x => t - x <= 2000);
    st.rejectTimes.push(t);
    const burst = st.rejectTimes.length >= 10;
    const opts: PushOpts = burst ? { reason: `위치 보정 급증 (2초 내 ${st.rejectTimes.length}건)`, rule: 'resync_burst' } : {};
    if (resync) {
      st.resyncSeq++;
      const mo = 2000 + rng() * 500, res = -9 + rng() * 12;
      this.push(vehicle, 'SEQ_INFO', t, M.positionResync(st.resyncSeq, ri(rng, 1, 5), st.opsCur, mo, res, st.lastPos), opts);
    } else {
      const inc = pick(rng, [1, 2, 3, 4, 5, 5, 5]);
      st.opsSeq += inc;
      this.push(vehicle, 'SEQ_INFO', t, M.markReject(st.opsSeq, inc, rng() < 0.5, -9 + rng() * 12, st.opsCur), opts);
    }
  }

  /** 노드 통과 허가 요청·승인 묶음 */
  private pushPass(vehicle: string, st: VState, t: number, node: number, next: number) {
    const code = ri(st.rng, 1, 9);
    this.push(vehicle, 'APP', t, M.passRequest(code, node, next));
    this.push(vehicle, 'APP', t + 1, M.passReceived(code, node, next));
    this.push(vehicle, 'APP', t + 2, M.passApproved(node));
  }

  /** DemoFleet 이벤트(= 파서가 실제 로그에서 뽑는 이벤트와 같은 모양)로부터 로그 줄을 만든다. */
  apply(vehicle: string, ev: LogEvent) {
    const st = this.state(vehicle), rng = st.rng, t = ev.time;
    switch (ev.kind) {
      case 'route': {
        const nodes = ev.nodes;
        const k = Math.min(nodes.length - 1, pick(rng, [1, 2, 3, 3, 4, 5]));
        const way = new Set<number>(); while (way.size < k && nodes.length > 1) way.add(ri(rng, 1, nodes.length - 1)); way.add(nodes.length - 1);
        const idx = [...way].sort((a, b) => a - b);
        const code = ri(rng, 1, 9), stops = idx.map(i => nodes[i]);
        this.push(vehicle, 'APP', t, M.routeRequest(code, stops));
        this.push(vehicle, 'APP', t + 20, M.routeReceived(code, stops));
        let prev = 0;
        for (const i of idx) { this.push(vehicle, 'APP', t + 21, M.routeSearch(nodes.slice(prev, i + 1), Math.round(ev.total * (i - prev) / (nodes.length - 1)) + ri(rng, 0, 120))); prev = i; }
        this.push(vehicle, 'APP', t + 24, M.routeCompose(nodes.length - 1));
        this.push(vehicle, 'APP', t + 24, M.routeFinal(nodes, ev.total + ri(rng, 0, 120)));
        this.push(vehicle, 'SEQ_INFO', t + 35, M.driveStart());
        this.push(vehicle, 'SEQ_INFO', t + 35, M.stateReadyToDriving());
        st.lastCur = null; st.driving = true;
        break;
      }
      case 'go': {
        const a = this.ops(st, ev.a), b = this.ops(st, ev.b);
        const steer = ev.type === 'RightCurve' ? 'Right' : ev.type === 'Straight' ? (rng() < 0.72 ? 'None' : rng() < 0.55 ? 'Right' : 'Left') : 'Left';
        const [acc, dec] = ev.type === 'Straight' ? [2000, 3000] : [1000, 1500];
        const g: GoInfo = {
          cmd: ev.cmd, a: ev.a, b: ev.b, dist: ev.distance, speed: ev.speed, steer, type: ev.type, line: LINE_NAME[ev.type] ?? LINE_NAME.Straight,
          area: pick(rng, AREA[ev.type] ?? AREA.Straight), acc, dec, det: DETECT[ev.type] ?? 16, am: a.m, as: a.s, bm: b.m, bs: b.s,
        };
        this.push(vehicle, 'OHT', t, M.goCommand(g), { thread: '6' });
        this.push(vehicle, 'OHT', t, M.goMarks(g), { thread: '6' });
        this.push(vehicle, 'API_CALL_INFO', t + 1, M.goApi(g));
        this.push(vehicle, 'SEQ_INFO', t + 1, M.goQueue(g));
        this.push(vehicle, 'APP', t + 80, M.goAck(g), { thread: '6' });
        break;
      }
      case 'status': {
        st.driving = ev.driving;
        if (ev.driving) {
          if (st.lastCur !== null && ev.cur !== st.lastCur) {
            // 노드 통과: 위치 마크 캡처 + 위치 보정
            const prev = this.ops(st, st.lastCur), cur = this.ops(st, ev.cur);
            this.push(vehicle, 'OPS', t, M.markCapture(prev.m[0], cur.m[0], prev.m[1], cur.m[1]));
            if (rng() < 0.85) this.push(vehicle, 'APP', t, M.positionCorrect(ev.pos, ev.pos + rng() * 4));
            const r = rng();
            if (r < 0.02) {
              // 통과 허가가 10초 넘게 오지 않는 경우: 대기 로그가 이어지다가 마지막 줄에서 누락으로 판정
              const node = ev.cur, next = ev.nxt;
              for (let i = 0; i <= 5; i++) {
                const at = t + i * 2000;
                const last = i === 5;
                const fn = () => this.push(vehicle, 'APP', at, M.passWaiting(node), last ? { reason: '통과 확인 누락 (10초 이상 대기)', rule: 'pass_missing' } : {});
                if (i === 0) fn(); else this.later(at, fn);
              }
              this.later(t + 10100, () => this.pushPass(vehicle, st, t + 10100, node, next));
            } else if (r < 0.27) {
              this.pushPass(vehicle, st, t, ev.cur, ev.nxt);
            }
          }
          st.lastCur = ev.cur;
          st.lastPos = ev.pos;
        }
        const period = ev.driving ? 3000 : 5000;
        if (t - st.lastSend >= period) {
          st.lastSend = t;
          st.sendCnt = st.sendCnt % 99 + 1;
          const msg = M.statusReport({ cnt: st.sendCnt, driving: ev.driving, x: ri(rng, 1, 9), cur: ev.cur, nxt: ev.nxt, dest: ev.dest, vel: ev.vel, rem: ev.rem, ver: st.ver, mac: st.mac, ch: st.ch, rssi: st.rssi, ip: st.ip, pos: ev.driving ? ev.pos : st.lastPos });
          this.push(vehicle, 'APP', t, msg, { thread: pick(rng, ['3', '17', '18']) });
        }
        break;
      }
      case 'arrived': {
        const cur = st.lastCur !== null ? this.ops(st, st.lastCur) : this.ops(st, 0);
        const pos = st.lastPos;
        const steer = rng() < 0.89 ? 'R' : 'L';
        // 최종 정지 전 저속 접근 구간의 위치 보정 (보통 2~3줄, 드물게 급증)
        const n = rng() < 0.03 ? 12 : ri(rng, 2, 3);
        for (let i = 0; i < n; i++) this.pushReject(vehicle, st, t - 1500 + i * Math.floor(1400 / n), i % 3 === 1);
        this.push(vehicle, 'SEQ_INFO', t, M.driveSummary({
          pos, tp: pos + ri(rng, -20, 20), tpOff: rng() * 40 - 20, curId: cur.m[0], curOff: cur.m[1] + rng(), markId: cur.m[0], markOff: cur.m[1], subId: cur.s[0], subOff: cur.s[1],
          vel2: 4 + rng() * 32, trq1: -54 + rng() * 44, trq2: -37 + rng() * 30, steer, dt: ri(rng, 4, 200), t1: ri(rng, 1200000000, 3900000000), t2: ri(rng, 1200000000, 3900000000), scan: ri(rng, 0, 215),
        }));
        this.push(vehicle, 'SEQ_INFO', t, M.driveEnd());
        this.push(vehicle, 'SEQ_INFO', t, M.stateDrivingToReady());
        if (rng() < 0.75) {
          this.push(vehicle, 'APP', t + 20, M.arrived(st.lastCur ?? 0));
          this.push(vehicle, 'APP', t + 20, M.arrivedReset());
        }
        if (rng() < 0.3) {
          // 이재 작업 센서 변화 (실제 빈도는 도착의 5% 수준이지만 데모에서는 조금 자주 보여준다)
          const m = ri(rng, 2, 4);
          for (let i = 0; i < m; i++) {
            const [grp, names, inputs, part] = pick(rng, IO_GROUPS);
            this.push(vehicle, 'IO', t + 1200 + i * 220, M.ioChange(grp, pick(rng, names), pick(rng, inputs), rng() < 0.5), { part });
          }
        }
        st.driving = false;
        break;
      }
    }
  }

  /** 주기 로그(무선 상태)와 이상 차량의 반복 로그, 예약된 로그 묶음. 100ms 마다 호출한다. */
  tick(now: number, vehicles: VehicleInfo[]) {
    if (this.pending.length) {
      const due = this.pending.filter(p => p.at <= now);
      this.pending = this.pending.filter(p => p.at > now);
      for (const p of due) p.fn();
    }
    for (const v of vehicles) {
      if (v.status === '무수신') continue;          // 수신이 끊긴 차량은 아무 줄도 만들지 않는다
      const st = this.state(v.id), rng = st.rng;
      const weak = v.status === '경고';
      if (now >= st.nextNet) {
        st.rssi = weak ? Math.max(-86, Math.min(-76, st.rssi + ri(rng, -1, 1))) : Math.max(-62, Math.min(-40, st.rssi + pick(rng, [-1, 0, 0, 0, 1])));
        if (weak && st.rssi > -76) st.rssi = -80;
        this.push(v.id, 'NET', now, M.wlanStatus(st.mac, st.ch, st.rssi), { thread: pick(rng, NET_THREADS), ...(st.rssi <= -75 ? { rule: 'net_degraded', reason: '무선 신호 약함' } : {}) });
        st.nextNet = now + 2014 + ri(rng, -3, 3);
      }
      if (now >= st.nextKpi) {
        const tx = Math.round(v.driving ? 800 + rng() * 8200 : 13 + rng() * 390);
        const retry = weak ? ri(rng, 3, 13) : rng() < 0.96 ? 0 : ri(rng, 1, 3);
        this.push(v.id, 'NET', now, M.wlanStats(tx, retry, weak ? ri(rng, 1, 6) : 0, weak), { thread: pick(rng, NET_THREADS), ...(weak ? { rule: 'net_degraded' } : {}) });
        st.nextKpi = now + 5006 + ri(rng, -4, 10);
      }
      if (v.status === '오류' && now >= st.nextFault) {
        if (v.id === 'OHT-0028') {
          // 제어 프로세스가 반복 재기동: 기동 로그 묶음이 계속 찍힌다. 5분 안에 2회 이상이면 이상.
          st.restartTimes = st.restartTimes.filter(x => now - x <= 300000);
          st.restartTimes.push(now);
          st.seq.PARTS_INFO = 0; st.seq.WMX = 0;
          const n = st.restartTimes.length;
          const opts: PushOpts = n >= 2 ? { severity: 'ERROR', reason: `반복 재기동 (5분 내 ${n}회)`, rule: 'restart' } : { rule: 'restart' };
          this.push(v.id, 'PARTS_INFO', now, M.processStart(), opts);
          for (const c of CONFIG_LINES) this.push(v.id, 'PARTS_INFO', now, c);
          this.push(v.id, 'WMX', now, M.processStart(), opts);
          st.nextFault = now + 18000 + rng() * 8000;
        } else {
          this.push(v.id, 'WMX', now, M.motionFail(), { level: 'ERROR', rule: 'motion_fail' });
          st.nextFault = now + 3000 + rng() * 2500;
        }
      }
      // 드물게 장애물 감지 정지 (주행 중 차량)
      if (v.driving && v.status === '운행' && rng() < 0.00025) {
        this.push(v.id, 'SEQ_INFO', now, M.obstaclePause({
          pos: st.lastPos, tpOff: -11 + rng() * 6, opsCur: st.opsCur, curOff: 400 + rng() * 100, tarOff: ri(rng, 450, 510), subOff: ri(rng, -1088, -438),
          vel2: 8 + rng() * 90, trq1: -50 + rng() * 60, trq2: -40 + rng() * 44, dt: ri(rng, 14, 32), t1: ri(rng, 1200000000, 3900000000), t2: ri(rng, 1200000000, 3900000000), scan: ri(rng, 0, 15),
        }), { rule: 'lidar_stop', part: '센서' });
      }
    }
  }
}
