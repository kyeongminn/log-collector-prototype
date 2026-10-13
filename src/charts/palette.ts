// 차트 색. 카테고리는 고정 순서의 범주 팔레트(검증 통과), 상태는 별도 색으로 둔다.
// 범주 색은 식별용이며 글자에는 쓰지 않는다. 대비가 낮은 색(aqua·yellow·magenta)은 직접 라벨과 표 보기로 보완한다.

export const TREND_CATS = ['OHT', 'SEQ_INFO', 'APP', 'OPS', 'NET', 'API_CALL_INFO', '기타'] as const;
export type TrendCat = (typeof TREND_CATS)[number];

export const CAT_COLOR: Record<TrendCat, string> = {
  OHT: '#2a78d6',
  SEQ_INFO: '#eb6834',
  APP: '#1baf7a',
  OPS: '#eda100',
  NET: '#e87ba4',
  API_CALL_INFO: '#008300',
  기타: '#9aa3b2',
};

export const STATUS_COLOR = { critical: '#d03b3b', warning: '#fab219' };

export function fmtCompact(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k`;
  return String(Math.round(v));
}
