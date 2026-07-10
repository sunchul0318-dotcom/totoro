// ============================================================
// 판교 퀘스트 — 스테이지 구성 (판교역 → 위메이드플레이)
// 각 스테이지: 고유 배경 팔레트 · 등장 빌런 · 웨이브 · 난이도 배율 · 스토리 비트
// ============================================================

import type { StageDef } from "./types";

export const STAGES: StageDef[] = [
  {
    id: 0,
    name: "판교역 개찰구",
    subtitle: "PANGYO STATION · GATE",
    intro: [
      "아침 8시 42분. 신분당선 판교역.",
      "오늘도 위메이드플레이로 출근하는 여정이 시작된다.",
      "개찰구 앞, 삑— 소리와 함께 빌런들이 길을 막는다!",
    ],
    outro: [
      "개찰구 돌파! 교통카드는 무사하다.",
      "하지만 진짜 지옥은 지하 환승 통로부터다…",
    ],
    bg: {
      top: "#12203a",
      bottom: "#0a1220",
      floor: "#1b2b48",
      grid: "#24406e",
      accent: "#ffcf4a",
    },
    hpScale: 1,
    atkScale: 1,
    speedScale: 1,
    waves: [
      { spawns: [{ kind: "gate", count: 3 }] },
      { spawns: [{ kind: "crowd", count: 4 }], delay: 900 },
      { spawns: [{ kind: "gate", count: 2 }, { kind: "crowd", count: 3 }] },
    ],
  },
  {
    id: 1,
    name: "지하 환승 통로",
    subtitle: "UNDERGROUND TRANSFER",
    intro: [
      "끝없이 이어지는 지하 환승 통로.",
      "길 잃은 사람들과 역주행 에스컬레이터가 뒤엉킨다.",
      "\"…환승 게이트가 어디죠?\"",
    ],
    outro: ["미로 같은 통로를 빠져나왔다.", "저 위로, 지상의 빛이 보인다."],
    bg: {
      top: "#1a1424",
      bottom: "#0d0a14",
      floor: "#2a2138",
      grid: "#43335c",
      accent: "#3fbf8f",
    },
    hpScale: 1.15,
    atkScale: 1.1,
    speedScale: 1.05,
    waves: [
      { spawns: [{ kind: "crowd", count: 5 }] },
      { spawns: [{ kind: "lost", count: 3 }], delay: 800 },
      {
        spawns: [
          { kind: "escalator", count: 2 },
          { kind: "lost", count: 2 },
        ],
      },
    ],
  },
  {
    id: 2,
    name: "지상 출구 계단",
    subtitle: "SURFACE EXIT",
    intro: [
      "출구 계단. 쏟아지는 햇살에 눈이 부시다.",
      "밀려드는 인파와 폭주 킥보드가 계단을 점령했다!",
    ],
    outro: ["드디어 지상! 판교의 아침 공기.", "저 앞엔 악명 높은 횡단보도가…"],
    bg: {
      top: "#2e3a66",
      bottom: "#16213f",
      floor: "#3a4a7a",
      grid: "#55689e",
      accent: "#ffd35a",
    },
    hpScale: 1.3,
    atkScale: 1.2,
    speedScale: 1.1,
    waves: [
      { spawns: [{ kind: "lost", count: 3 }, { kind: "crowd", count: 3 }] },
      { spawns: [{ kind: "kickboard", count: 2 }], delay: 900 },
      {
        spawns: [
          { kind: "escalator", count: 2 },
          { kind: "kickboard", count: 2 },
        ],
      },
    ],
  },
  {
    id: 3,
    name: "죽음의 횡단보도",
    subtitle: "THE CROSSWALK",
    intro: [
      "판교역 사거리. 신호는 변덕스럽고 킥보드는 무단질주.",
      "\"초록불일 때 건너야 하는데…\"",
      "변덕쟁이 신호등이 당신을 노려본다!",
    ],
    outro: ["횡단보도 통과! 반은 왔다.", "커피 향이 풍기는 카페거리가 눈앞에."],
    bg: {
      top: "#20304f",
      bottom: "#0e1626",
      floor: "#28385c",
      grid: "#3a5488",
      accent: "#e8544f",
    },
    hpScale: 1.45,
    atkScale: 1.3,
    speedScale: 1.15,
    waves: [
      { spawns: [{ kind: "kickboard", count: 3 }] },
      { spawns: [{ kind: "signal", count: 1 }, { kind: "crowd", count: 4 }], delay: 700 },
      {
        spawns: [
          { kind: "signal", count: 2 },
          { kind: "kickboard", count: 2 },
        ],
      },
    ],
  },
  {
    id: 4,
    name: "카페거리",
    subtitle: "CAFE STREET",
    intro: [
      "테크노밸리 카페거리. 출근 전 카페인 충전 타임.",
      "하지만 대기줄은 끝이 없고, 알림은 쉴 새 없이 쏟아진다.",
      "딩— 딩— 딩—!",
    ],
    outro: ["아이스 아메리카노 획득 (마음속으로).", "이제 회사 로비다. 거의 다 왔다!"],
    bg: {
      top: "#3a2a1e",
      bottom: "#1c130c",
      floor: "#4a3524",
      grid: "#6e4f34",
      accent: "#ff5d8f",
    },
    hpScale: 1.6,
    atkScale: 1.4,
    speedScale: 1.2,
    waves: [
      { spawns: [{ kind: "notification", count: 5 }] },
      { spawns: [{ kind: "queue", count: 1 }, { kind: "notification", count: 3 }], delay: 900 },
      {
        spawns: [
          { kind: "signal", count: 1 },
          { kind: "queue", count: 1 },
          { kind: "notification", count: 4 },
        ],
      },
    ],
  },
  {
    id: 5,
    name: "위메이드플레이 로비",
    subtitle: "WEMADE PLAY · LOBBY",
    intro: [
      "드디어 회사 건물 로비에 도착했다.",
      "출입증을 대지만— 삑! 인식 오류.",
      "엘리베이터는 만원, 알림은 폭주. 최종 관문이다.",
    ],
    outro: ["로비 돌파! 엘리베이터가 열린다.", "최상층으로— 저 위에 무언가가 기다린다…"],
    bg: {
      top: "#101a30",
      bottom: "#070c18",
      floor: "#18233f",
      grid: "#2a3d66",
      accent: "#2a5cff",
    },
    hpScale: 1.8,
    atkScale: 1.5,
    speedScale: 1.25,
    waves: [
      { spawns: [{ kind: "badge", count: 1 }, { kind: "notification", count: 3 }] },
      { spawns: [{ kind: "queue", count: 2 }], delay: 800 },
      {
        spawns: [
          { kind: "badge", count: 2 },
          { kind: "queue", count: 1 },
          { kind: "notification", count: 3 },
        ],
      },
    ],
  },
  {
    id: 6,
    name: "최상층 · 먼데이 모닝",
    subtitle: "FINAL FLOOR · BOSS",
    intro: [
      "엘리베이터 문이 열린다. 텅 빈 최상층.",
      "그 순간, 사무실 전체가 어둠에 잠기고—",
      "월요일 아침의 화신, 「먼데이 모닝」이 강림한다!",
    ],
    outro: [
      "「먼데이 모닝」 격파!!",
      "당신의 자리가 보인다. 노트북이 당신을 기다린다.",
      "…출근, 성공.",
    ],
    isBoss: true,
    bg: {
      top: "#1a0e28",
      bottom: "#05030a",
      floor: "#241436",
      grid: "#3a2054",
      accent: "#ff3a3a",
    },
    hpScale: 1,
    atkScale: 1.5,
    speedScale: 1.2,
    waves: [{ spawns: [{ kind: "boss", count: 1 }] }],
  },
];

// intro/outro 이전에 공통으로 흐르는 오프닝 & 엔딩 서사
export const OPENING: string[] = [
  "── 판교 퀘스트 ──",
  "위메이드플레이의 신입, 당신.",
  "매일 아침, 판교역에서 회사까지의 여정은",
  "그 자체로 하나의 던전이었다.",
  "오늘도 정시 출근을 위해— 모험을 떠나자!",
];

export const ENDING: string[] = [
  "먼데이 모닝을 물리치고, 당신은 자리에 앉았다.",
  "노트북을 열자 슬랙 알림이 반갑게 깜빡인다.",
  "\"좋은 아침입니다!\"",
  "또 하나의 출근 퀘스트, 클리어.",
  "…내일도, 판교의 아침은 밝아온다.",
];
