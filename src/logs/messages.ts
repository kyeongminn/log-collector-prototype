// 로그 메시지 문구와 화면에 노출되는 예시 문구 (공개 배포용 가상 문구).
//
// 공개 빌드에서는 실제 장비 로그 문구 대신 이 가상 문구를 쓴다.
// 줄의 골격(시각·카테고리·레벨·순번/스레드)과 화면 동작은 내부 버전과 같고, 메시지 본문만 다르다.

import type { PartName } from '../partStatus';

/** 링크 주행 명령 이름 (첫 링크 / 이어지는 링크) */
export const CMD = { first: 'START', next: 'CONT' };

export const LINE_NAME: Record<string, string> = { Straight: 'straight', RightCurve: 'curve-r', LeftCurve: 'curve-l', Uturn: 'curve-l' };
export const AREA: Record<string, string[]> = { Straight: ['zone-s'], RightCurve: ['zone-r1', 'zone-r2'], LeftCurve: ['zone-l'], Uturn: ['zone-u1', 'zone-u2'] };

/** 이재 센서 그룹: [그룹, 센서 이름들, 입력 번호들, 관련 부품] */
export const IO_GROUPS: ReadonlyArray<readonly [string, readonly string[], readonly string[], PartName]> = [
  ['gripper', ['lock_a', 'lock_b', 'pos_1', 'pos_2', 'push'], ['1.1', '1.2', '1.3', '1.4', '1.5'], '그리퍼'],
  ['hoist', ['home', 'sway'], ['2.1', '2.2'], '승강부'],
  ['safety', ['carrier_door', 'carrier_detect'], ['3.1', '3.2'], '센서'],
];

export const CONFIG_LINES = ['config.load log.dir=by-date', 'config.load log.base=/var/log/agent', 'config.load log.compress=off'];

/** 이상 탐지 규칙 설명 (규칙 ID → 설명) */
export const RULE_DESC: Record<string, string> = {
  motion_fail: 'WMX 에 주행 모션 명령 실패가 기록됨',
  restart: 'PARTS_INFO·WMX 에 프로세스 기동 기록. 5분 안에 반복되면 이상, 1회는 주의',
  resync_burst: 'SEQ_INFO 의 위치 보정 기록이 2초 안에 10건 이상',
  net_degraded: 'NET 의 무선 품질 저하 표시 또는 RSSI -75 dBm 이하',
  pass_missing: 'APP 의 노드 통과 대기 기록이 10초 이상 이어짐',
  lidar_stop: 'SEQ_INFO 의 장애물 감지 정지 기록',
  slip_skip: 'SEQ_INFO 의 슬립 보정 건너뜀 기록',
};

/** 화면 문구 */
export const UI = {
  searchPlaceholder: '원문 키워드를 입력하세요. 예: link.cmd, obstacle, quality=poor',
  searchHints: ['link.cmd', 'obstacle', 'quality=poor', 'process.start', 'arrive', 'rssi'],
  omittedNote: '반복 주기 로그 제외',
  summaryMotionFail: '주행 모션 명령 실패',
  summaryRestart: '제어 프로세스 반복 재기동',
  summaryNetWeak: '무선 신호 강도 저하',
};

export interface GoInfo {
  cmd: string; a: number; b: number; dist: number; speed: number; steer: string; type: string; line: string; area: string;
  acc: number; dec: number; det: number; am: [number, number]; as: [number, number]; bm: [number, number]; bs: [number, number];
}
export interface StatusInfo { cnt: number; driving: boolean; x: number; cur: number; nxt: number; dest: number; vel: number; rem: number; ver: string; mac: string; ch: number; rssi: number; ip: string; pos: number }
export interface EndInfo { pos: number; tp: number; tpOff: number; curId: number; curOff: number; markId: number; markOff: number; subId: number; subOff: number; vel2: number; trq1: number; trq2: number; steer: string; dt: number; t1: number; t2: number; scan: number }
export interface PauseInfo { pos: number; tpOff: number; opsCur: number; curOff: number; tarOff: number; subOff: number; vel2: number; trq1: number; trq2: number; dt: number; t1: number; t2: number; scan: number }

/** 메시지 본문 생성 함수 (가상 문구) */
export const M = {
  routeRequest: (code: number, stops: number[]) => `route.request code=${code} stops=${stops.join('>')}`,
  routeReceived: (code: number, stops: number[]) => `route.received code=${code} stops=${stops.join('>')}`,
  routeSearch: (seg: number[], dist: number) => `route.search ${seg[0]}>${seg[seg.length - 1]} via=${seg.join(',')} dist=${dist}`,
  routeCompose: (links: number) => `route.compose links=${links}`,
  routeFinal: (nodes: number[], dist: number) => `route.final nodes=${nodes.join(',')} dist=${dist}`,
  driveStart: () => 'drive.begin',
  stateReadyToDriving: () => 'state ready>driving',
  goCommand: (g: GoInfo) => `link.cmd ${g.cmd} ${g.a}>${g.b} dist=${g.dist} speed=${g.speed} steer=${g.steer.toLowerCase()} type=${g.line}`,
  goMarks: (g: GoInfo) => `link.marks from=${g.am[0]}/${g.am[1]} to=${g.bm[0]}/${g.bm[1]}`,
  goApi: (g: GoInfo) => `api.link ${g.cmd} ${g.a}>${g.b} dist=${g.dist} speed=${g.speed} acc=${g.acc} dec=${g.dec} zone=${g.area}`,
  goQueue: (g: GoInfo) => `drive.queue ${g.cmd} ${g.a}>${g.b} dist=${g.dist}`,
  goAck: (g: GoInfo) => `link.ack ${g.cmd} ${g.a}>${g.b}`,
  markCapture: (prevId: number, curId: number, prevOff: number, curOff: number) => `mark.capture ${prevId}>${curId} offset=${prevOff}>${curOff}`,
  positionCorrect: (pos: number, corrected: number) => `pos.correct ${pos.toFixed(0)}>${corrected.toFixed(1)}`,
  passWaiting: (node: number) => `node.wait ${node} pending`,
  passRequest: (code: number, node: number, next: number) => `node.permit.request ${node}>${next} code=${code}`,
  passReceived: (code: number, node: number, next: number) => `node.permit.reply ${node}>${next} code=${code}`,
  passApproved: (node: number) => `node.permit.granted ${node}`,
  statusReport: (s: StatusInfo) => `status #${s.cnt} ${s.driving ? 'moving' : 'idle'} at=${s.cur} next=${s.driving ? s.nxt : s.cur} dest=${s.driving ? s.dest : s.cur} v=${s.driving ? s.vel : 0} remain=${s.driving ? s.rem : 0} pos=${s.pos.toFixed(1)} rssi=${s.rssi}`,
  driveSummary: (e: EndInfo) => `drive.summary state=ready pos=${e.pos.toFixed(1)} mark=${e.markId}/${e.markOff} steer=${e.steer}`,
  driveEnd: () => 'drive.end',
  stateDrivingToReady: () => 'state driving>ready',
  arrived: (node: number) => `arrive node=${node}`,
  arrivedReset: () => 'arrive.reset',
  ioChange: (group: string, name: string, input: string, on: boolean) => `io ${group}.${name} in=${input} ${on ? '0>1' : '1>0'}`,
  wlanStatus: (_mac: string, ch: number, rssi: number) => `wlan.status ch=${ch} rssi=${rssi}`,
  wlanStats: (tx: number, retry: number, fcs: number, poor: boolean) => `wlan.stats tx=${tx} retry=${retry} err=${fcs} quality=${poor ? 'poor' : 'ok'}`,
  processStart: () => 'process.start',
  motionFail: () => 'motion.command.error reason=state-mismatch',
  obstaclePause: (p: PauseInfo) => `drive.pause reason=obstacle pos=${p.pos.toFixed(1)}`,
  positionResync: (n: number, _cnt: number, ops: number, _moving: number, residual: number, _pos: number) => `pos.resync #${n} mark=${ops} residual=${residual.toFixed(2)}`,
  markReject: (seq: number, _inc: number, _forced: boolean, residual: number, _ops: number) => `mark.reject seq=${seq} residual=${residual.toFixed(2)}`,
};
