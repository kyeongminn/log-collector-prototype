// 장비 로그 이벤트 타입.
//
// 공개 빌드에는 실제 장비 로그 파서를 포함하지 않는다. 화면은 데모 구동기(demoFleet)가 만드는
// 같은 모양의 이벤트로 동작한다. parseLine 은 형태만 남겨 두었고 항상 null 을 돌려준다.

export type LinkTypeName = 'Straight' | 'RightCurve' | 'LeftCurve' | 'Uturn';

export type LogEvent =
  | { kind: 'status'; time: number; cur: number; nxt: number; dest: number; driving: boolean; vel: number; rem: number; pos: number }
  | { kind: 'route'; time: number; nodes: number[]; total: number }
  | { kind: 'go'; time: number; cmd: string; a: number; b: number; distance: number; speed: number; type: LinkTypeName }
  | { kind: 'arrived'; time: number };

export function parseLine(_line: string): LogEvent | null {
  return null;
}
