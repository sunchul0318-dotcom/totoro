// ============================================================
// 판교 퀘스트 — 밸런싱/튜닝 상수
// 한 곳에서 게임 필과 난이도를 조율한다.
// ============================================================

// 논리 해상도 — 16:9 가로형 기준. 실제 화면은 부모(iframe) 크기에 맞춰 균일 스케일링.
export const VIEW_W = 960;
export const VIEW_H = 540;

// 아레나(플레이 가능 영역) 여백
export const ARENA_PAD = 36;

export const PLAYER = {
  baseMaxHp: 120,
  baseAtk: 22,
  speed: 3.15, // px/frame (60fps 기준)
  radius: 15,

  // 공격
  attackCooldown: 300, // ms
  attackActive: 130, // 히트박스 유지 시간
  attackReach: 62,
  attackArc: Math.PI * 0.85, // 부채꼴 각도
  comboWindow: 460, // ms 안에 다시 누르면 콤보 유지
  comboMax: 3,

  // 회피 구르기
  dodgeSpeed: 7.2,
  dodgeDuration: 230, // ms
  dodgeIFrames: 300, // ms 무적
  dodgeCooldown: 720, // ms

  // 필살기 (커피 스매시)
  skillCost: 100,
  skillRadius: 150,
  skillDamageMult: 2.6,
  skillCooldown: 500,
  energyPerHit: 9,

  // 피격
  hurtIFrames: 700, // 피격 후 무적
  hurtKnockback: 8,
};

// 레벨업 곡선: 다음 레벨까지 필요한 EXP
export function expToNext(level: number): number {
  return Math.floor(24 + (level - 1) * 18 + Math.pow(level - 1, 1.7) * 6);
}

// 레벨업 보상
export const LEVELUP = {
  hpPerLevel: 18,
  atkPerLevel: 4,
  healOnLevelUp: 0.35, // 최대 HP의 35% 회복
};

// 스테이지 클리어 시 회복 비율
export const STAGE_CLEAR_HEAL = 0.45;

// 드롭 확률
export const DROP = {
  coffeeChance: 0.16, // 커피(회복)
  coffeeHeal: 26,
  energyDrinkChance: 0.08, // 에너지드링크(공격 버프)
  buffDuration: 8000, // ms
  buffAtkMult: 1.6,
};

// 피격 데미지 숫자/이펙트
export const FX = {
  shakeHitPlayer: 9,
  shakeHitEnemy: 3,
  shakeSkill: 16,
  shakeBoss: 22,
};

// 컨티뉴(리스폰) 허용 횟수 (등급 계산에 반영)
export const MAX_CONTINUES = 3;
