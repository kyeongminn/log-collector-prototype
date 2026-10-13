// 부품 상태 가상 데이터. 실제 수집 데이터가 연결되기 전까지 화면 확인용으로만 사용합니다.
import { UI } from './logs/messages';

export type PartName = '주행부' | '승강부' | '그리퍼' | '센서' | '통신 모듈' | '제어부';
export type PartLevel = '정상' | '경고' | '오류';

export type Metric = { label: string; value: string; alert?: boolean };
export type PartStatus = { level: PartLevel; summary: string; metrics: Metric[] };

export const PART_NAMES: PartName[] = ['주행부', '승강부', '그리퍼', '센서', '통신 모듈', '제어부'];

type VehicleLike = { id: string; status: string; part: string };

// 차량 ID와 부품 이름으로 항상 같은 값이 나오도록 하는 간단한 해시
function seed(id: string, part: string) {
  let h = 0;
  for (const c of id + part) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (n: number, min: number, max: number) => min + (((h >>> (n * 3)) % 1000) / 1000) * (max - min);
}

export function partLevel(v: VehicleLike, part: string): PartLevel {
  if (v.part !== part) return '정상';
  if (v.status === '오류') return '오류';
  if (v.status === '경고' || v.status === '무수신') return '경고';
  return '정상';
}

export function getPartStatus(v: VehicleLike, part: PartName): PartStatus {
  const r = seed(v.id, part);
  const level = partLevel(v, part);
  if (v.status === '무수신' && v.part === part) {
    return {
      level: '경고',
      summary: '로그 수신 끊김 (무수신)',
      metrics: [
        { label: '수신 상태', value: '끊김', alert: true },
        { label: '마지막 로그', value: '상태 송신 (대기)' },
        { label: '에이전트', value: '응답 없음', alert: true },
        { label: '현장 점검', value: '필요' },
      ],
    };
  }
  const bad = level !== '정상';
  const fix = (x: number, d = 0) => x.toFixed(d);

  switch (part) {
    case '주행부':
      return {
        level,
        summary: bad ? UI.summaryMotionFail : '주행 모터 정상 동작',
        metrics: [
          { label: '모터 온도', value: `${fix(bad ? 71.4 : r(1, 38, 52), 1)} °C`, alert: bad },
          { label: '주행 속도', value: `${bad ? 0 : fix(r(2, 180, 240))} m/min` },
          { label: '모터 응답', value: bad ? '1,240 ms' : `${fix(r(3, 8, 20))} ms`, alert: bad },
          { label: '누적 주행', value: `${fix(r(4, 1200, 4800)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} km` },
        ],
      };
    case '승강부':
      return {
        level,
        summary: bad ? '벨트 장력 편차 감지' : '승강 위치 정상',
        metrics: [
          { label: '벨트 장력', value: `${fix(bad ? 212 : r(1, 290, 320))} N`, alert: bad },
          { label: '승강 위치', value: `${fix(r(2, 0, 30))} mm` },
          { label: '일 승강 횟수', value: `${fix(r(3, 140, 420))} 회` },
          { label: '모터 온도', value: `${fix(r(4, 34, 46), 1)} °C` },
        ],
      };
    case '그리퍼':
      return {
        level,
        summary: bad ? '그리퍼 잠금 응답 지연' : '그리퍼 잠금 확인',
        metrics: [
          { label: '잠금 상태', value: bad ? '확인 불가' : '잠금', alert: bad },
          { label: 'FOUP 감지', value: '감지됨' },
          { label: '개폐 응답', value: `${fix(bad ? 940 : r(3, 110, 180))} ms`, alert: bad },
          { label: '일 개폐 횟수', value: `${fix(r(4, 140, 420))} 회` },
        ],
      };
    case '센서':
      return {
        level,
        summary: bad ? '장애물 센서 신호 불안정' : '장애물 감지 센서 정상',
        metrics: [
          { label: '감지 상태', value: bad ? '불안정' : '정상', alert: bad },
          { label: '전방 거리', value: `${fix(r(2, 2.5, 8), 1)} m` },
          { label: '렌즈 오염도', value: `${fix(bad ? 38 : r(3, 2, 9))} %`, alert: bad },
          { label: '점검 후 경과', value: `${fix(r(4, 3, 40))} 일` },
        ],
      };
    case '통신 모듈':
      return {
        level,
        summary: bad ? UI.summaryNetWeak : '관제 서버 연결 유지',
        metrics: [
          { label: '신호 강도', value: `${fix(bad ? -82 : r(1, -61, -48))} dBm`, alert: bad },
          { label: '패킷 손실', value: `${fix(bad ? 4.8 : r(2, 0, 0.4), 1)} %`, alert: bad },
          { label: '응답 지연', value: `${fix(bad ? 186 : r(3, 6, 24))} ms` },
          { label: '접속 AP', value: `AP-${String(Math.round(r(4, 1, 24))).padStart(2, '0')}` },
        ],
      };
    case '제어부':
      return {
        level,
        summary: bad ? UI.summaryRestart : '제어기 정상 동작',
        metrics: [
          { label: 'CPU 사용률', value: `${fix(bad ? 97 : r(1, 18, 42))} %`, alert: bad },
          { label: '메모리', value: `${fix(r(2, 38, 64))} %` },
          { label: '프로세스', value: bad ? '재기동 반복' : '실행 중', alert: bad },
          { label: '가동 시간', value: `${fix(r(4, 2, 30))} 일` },
        ],
      };
  }
}
