// 로그 추이용 예상 건수 모델.
//
// 화면은 반복 주기 로그를 생성하지 않으므로, 전체 유입량 추이는 실제 장비 통계(시뮬레이터 템플릿의
// 시간대별 생성량)를 바탕으로 추정한다. 시간대 가중치는 실측 하루 프로파일(20시 최대, 12시 최저,
// 새벽 2~8시 거의 없음)을 정규화한 값이다. 운영에서는 ClickHouse 사전 집계(STO-404)가 이 자리를 대신한다.

import { BYTES_PER_LINE, LINES_PER_HOUR, type Category } from '../logs/logStream';
import { TREND_CATS, type TrendCat } from './palette';

/** 0시~23시 활동 가중치 (최대 1) */
export const HOUR_WEIGHT = [0.57, 0.26, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.48, 0.68, 0.53, 0.09, 0.67, 0.27, 0.62, 0.75, 0.88, 0.90, 0.94, 1.00, 0.89, 0.93, 0.92];

const CAT_OF: Record<Category, TrendCat> = { OHT: 'OHT', SEQ_INFO: 'SEQ_INFO', APP: 'APP', OPS: 'OPS', NET: 'NET', API_CALL_INFO: 'API_CALL_INFO', PARTS_INFO: '기타', WMX: '기타', IO: '기타' };

function noise(seed: number) {
  // 결정적 ±8% 잡음
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return 0.92 + ((h ^ (h >>> 16)) % 1000) / 1000 * 0.16;
}

/** [start, end) 구간의 카테고리별 예상 줄 수 */
export function expectedCounts(start: number, end: number, vehicles: number): Record<TrendCat, number> {
  const out = Object.fromEntries(TREND_CATS.map(c => [c, 0])) as Record<TrendCat, number>;
  // 시간 단위로 잘라 가중치를 적분한다
  let t = start;
  while (t < end) {
    const d = new Date(t);
    const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
    const hourEnd = hourStart + 3600000;
    const seg = Math.min(end, hourEnd) - t;
    const frac = seg / 3600000;
    const w = HOUR_WEIGHT[d.getHours()] * noise(Math.floor(hourStart / 3600000));
    for (const c of Object.keys(LINES_PER_HOUR) as Category[]) out[CAT_OF[c]] += LINES_PER_HOUR[c] * vehicles * w * frac;
    t = Math.min(end, hourEnd);
  }
  for (const c of TREND_CATS) out[c] = Math.round(out[c]);
  return out;
}

/** [start, end) 구간의 카테고리별 예상 줄 수와 바이트 (세부 카테고리 9종 기준) */
export function expectedByCategory(start: number, end: number, vehicles: number): Record<Category, { lines: number; bytes: number }> {
  const out = Object.fromEntries((Object.keys(LINES_PER_HOUR) as Category[]).map(c => [c, { lines: 0, bytes: 0 }])) as Record<Category, { lines: number; bytes: number }>;
  let t = start;
  while (t < end) {
    const d = new Date(t);
    const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
    const hourEnd = hourStart + 3600000;
    const frac = (Math.min(end, hourEnd) - t) / 3600000;
    const w = HOUR_WEIGHT[d.getHours()] * noise(Math.floor(hourStart / 3600000));
    for (const c of Object.keys(LINES_PER_HOUR) as Category[]) out[c].lines += LINES_PER_HOUR[c] * vehicles * w * frac;
    t = Math.min(end, hourEnd);
  }
  for (const c of Object.keys(out) as Category[]) { out[c].lines = Math.round(out[c].lines); out[c].bytes = Math.round(out[c].lines * BYTES_PER_LINE[c]); }
  return out;
}

/** [start, end) 구간의 가상 이상·주의 건수. 30대 기준 하루 수십 건 수준에 드문 급증을 섞는다. */
export function syntheticAbnormal(start: number, end: number, vehicles: number): { err: number; warn: number } {
  const hours = (end - start) / 3600000;
  const seedBase = Math.floor(start / 60000);
  const n1 = noise(seedBase * 7), n2 = noise(seedBase * 13);
  const spike = ((seedBase * 2654435761) >>> 0) % 97 === 3;   // 드문 급증
  const warn = Math.round(hours * vehicles * 0.06 * n1 * (spike ? 6 : 1));
  const err = Math.round(hours * vehicles * 0.012 * n2 * (spike ? 8 : 1));
  return { err, warn };
}
