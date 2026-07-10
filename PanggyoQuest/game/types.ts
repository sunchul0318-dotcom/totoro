// ============================================================
// 판교 퀘스트 — 공용 타입 정의
// ============================================================

export type EnemyKind =
  | "gate" // 잔액부족 게이트 — 느린 추격
  | "crowd" // 밀치는 인파 — 스웜/넉백
  | "lost" // 길잃은 환승객 — 배회 + 돌진
  | "escalator" // 역주행 에스컬레이터 — 직선 왕복, 넉백 무효
  | "kickboard" // 킥보드 — 예고 후 직선 대시
  | "signal" // 신호등 — 빨강(무적/발사) / 초록(피격가능)
  | "notification" // 푸시 알림 — 비행 + 투사체
  | "queue" // 커피 대기줄 — 느린 탱커
  | "badge" // 출입증 인식오류 — 고정 포탑 (링 발사)
  | "boss"; // 먼데이 모닝 — 최종 보스

export interface EnemyDef {
  kind: EnemyKind;
  name: string; // 한글 이름
  hp: number;
  atk: number; // 접촉/투사체 피해
  speed: number;
  radius: number;
  exp: number;
  color: string;
  accent: string;
  knockbackResist: number; // 0~1 (1이면 넉백 무효)
  desc: string; // 도감/스토리용 한 줄
}

export interface Wave {
  // 스폰할 적 목록 (kind, count)
  spawns: { kind: EnemyKind; count: number }[];
  // 이 웨이브를 시작하기 전 딜레이(ms) — 스테이지 시작 후 첫 웨이브는 0 권장
  delay?: number;
}

export interface StageDef {
  id: number;
  name: string; // 예: "판교역 개찰구"
  subtitle: string; // 영문/부제
  intro: string[]; // 스테이지 시작 대사 (드퀘풍)
  outro: string[]; // 스테이지 클리어 대사
  bg: {
    top: string;
    bottom: string;
    floor: string;
    grid: string;
    accent: string;
  };
  waves: Wave[];
  hpScale: number; // 적 HP 배율
  atkScale: number; // 적 공격 배율
  speedScale: number; // 적 이동 배율
  isBoss?: boolean;
}

export interface HudState {
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  expToNext: number;
  energy: number; // 필살기 자원 0~100
  maxEnergy: number;
  atk: number;
  combo: number;
  stageIndex: number;
  stageName: string;
  enemiesLeft: number;
  waveText: string;
  buffTimer: number; // 에너지드링크 버프 남은 시간(초)
  dodgeReady: boolean;
  bossHp?: number;
  bossMaxHp?: number;
  bossName?: string;
  bossPhase?: number;
}

export interface RunStats {
  timeMs: number;
  kills: number;
  level: number;
  damageTaken: number;
  deaths: number; // 사용한 컨티뉴 수
  stageReached: number;
}

export type EngineEvents = {
  onHud: (hud: HudState) => void;
  onStageClear: (stageIndex: number) => void;
  onGameOver: (stats: RunStats) => void;
  onVictory: (stats: RunStats) => void;
  onLevelUp: (level: number) => void;
  onPauseRequest: () => void;
};
