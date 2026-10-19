import type { ReactNode } from 'react';
import type { PartName } from './partStatus';

/** 3D 모델의 부품 모양을 단순하게 줄인 아이콘. 선·면 색은 currentColor(부품 상태 색)를 따른다. */
const SHAPES: Record<PartName, ReactNode> = {
  // 바퀴 + 모터
  주행부: <><rect x="11.5" y="4" width="9" height="7" rx="1.2" /><circle cx="9" cy="14.5" r="5.5" /><circle cx="9" cy="14.5" r="1.8" /></>,
  // 상부 승강 박스 + 벨트 두 줄 + 아래 받침
  승강부: <><rect x="4" y="3" width="16" height="6" rx="1.2" /><path d="M9 9v8M15 9v8" /><rect x="6.5" y="17" width="11" height="3.5" rx="1" /></>,
  // 잡는 판 + 양쪽 집게
  그리퍼: <><rect x="3.5" y="5" width="17" height="4" rx="1" /><path d="M7 9v8.5h3M17 9v8.5h-3" /></>,
  // 센서 하우징 + 렌즈 + 감지 범위
  센서: <><rect x="5" y="4" width="14" height="9" rx="2" /><circle cx="12" cy="8.5" r="2.2" /><path d="M7.5 17c2.8 2 6.2 2 9 0M9.5 20.5c1.6.8 3.4.8 5 0" /></>,
  // 모듈 + 안테나 + 표시등
  '통신 모듈': <><rect x="4.5" y="11" width="15" height="8.5" rx="1.5" /><path d="M12 11V5.5M8.6 5a5 5 0 0 1 6.8 0" /><circle cx="8.5" cy="15.2" r="1.1" /></>,
  // 제어 박스 + 화면 + 비상정지 버튼
  제어부: <><rect x="6" y="2.5" width="12" height="19" rx="1.5" /><rect x="8.8" y="5.5" width="6.4" height="5" rx=".6" /><circle cx="12" cy="15.5" r="1.8" /></>,
};

export default function PartIcon({ part, size = 22 }: { part: PartName; size?: number }) {
  return (
    <svg className="part-icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {SHAPES[part]}
    </svg>
  );
}
