"use client";

import { useEffect } from "react";
import type { RunStats } from "@/game/types";
import { STAGES } from "@/game/stages";

// 모든 오버레이는 960x540 스테이지 좌표계에 고정 px 로 배치된다 (스테이지와 함께 스케일됨).

export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function computeRank(stats: RunStats): { rank: string; color: string; comment: string } {
  const min = stats.timeMs / 60000;
  if (stats.deaths === 0 && min < 7)
    return { rank: "S", color: "#ffcf4a", comment: "완벽한 정시 출근! 오늘의 MVP." };
  if (stats.deaths <= 1 && min < 11)
    return { rank: "A", color: "#7bff8f", comment: "훌륭한 출근길. 커피 한 잔의 여유." };
  if (stats.deaths <= 3)
    return { rank: "B", color: "#7c9bff", comment: "무사히 도착. 지각은 면했다." };
  return { rank: "C", color: "#ff8f8f", comment: "겨우 도착… 그래도 출근은 출근." };
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-[2px] p-4">
      {children}
    </div>
  );
}

// ---------- 타이틀 ----------
export function TitleScreen({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "enter" || k === " " || k === "j" || k === "z") {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart]);

  return (
    <Backdrop>
      <div className="text-center max-w-[620px]">
        <div className="text-dq-gold text-[11px] tracking-[0.4em] mb-2">
          WEMADE PLAY PRESENTS
        </div>
        <h1
          className="text-6xl font-black tracking-tight text-shadow-hard mb-1"
          style={{ color: "#ffcf4a" }}
        >
          판교 퀘스트
        </h1>
        <div className="text-white/80 text-sm tracking-[0.3em] mb-4">
          P A N G Y O &nbsp; Q U E S T
        </div>
        <p className="text-white/70 text-sm mb-5 leading-relaxed">
          지하철 판교역에서 위메이드플레이까지.
          <br />
          출근길 빌런을 무찌르고, 정시 출근을 사수하라!
        </p>

        <button onClick={onStart} className="dq-btn text-lg px-8 py-2.5 animate-blink">
          ▶ PRESS START
        </button>

        <div className="dq-window mt-5 p-4 text-left text-xs text-white/80 mx-auto max-w-[420px]">
          <div className="text-dq-gold font-bold mb-2 tracking-widest">◆ 조작법</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span>이동</span>
            <span className="text-white/60">WASD / 화살표</span>
            <span>공격 (콤보)</span>
            <span className="text-white/60">J / Z / Space</span>
            <span>회피 구르기</span>
            <span className="text-white/60">K / X / Shift</span>
            <span>필살기 (SP 100)</span>
            <span className="text-white/60">L / C</span>
            <span>일시정지</span>
            <span className="text-white/60">ESC / P</span>
          </div>
          <div className="mt-2 text-white/50">📱 모바일: 좌측 조이스틱 + 우측 버튼</div>
        </div>
      </div>
    </Backdrop>
  );
}

// ---------- 일시정지 ----------
export function PauseScreen({
  onResume,
  onTitle,
}: {
  onResume: () => void;
  onTitle: () => void;
}) {
  return (
    <Backdrop>
      <div className="dq-window p-7 text-center w-full max-w-[360px]">
        <h2 className="text-3xl font-black text-dq-gold mb-6 tracking-widest">
          ❚❚ 일시정지
        </h2>
        <div className="flex flex-col gap-3">
          <button onClick={onResume} className="dq-btn">
            계속하기
          </button>
          <button onClick={onTitle} className="dq-btn">
            타이틀로 돌아가기
          </button>
        </div>
        <div className="mt-5 text-xs text-white/50 leading-relaxed">
          이동 WASD · 공격 J · 회피 K · 필살기 L
        </div>
      </div>
    </Backdrop>
  );
}

// ---------- 스테이지 클리어 ----------
export function StageClearScreen({
  stageIndex,
  stats,
  onNext,
}: {
  stageIndex: number;
  stats: RunStats;
  onNext: () => void;
}) {
  const stage = STAGES[stageIndex];
  const next = STAGES[stageIndex + 1];
  return (
    <Backdrop>
      <div className="dq-window p-6 text-center w-full max-w-[520px]">
        <div className="text-green-300 text-xs tracking-[0.3em] mb-1">STAGE CLEAR</div>
        <h2 className="text-2xl font-black text-dq-gold mb-3 text-shadow-hard">
          {stage.name} 돌파!
        </h2>
        <div className="text-left text-sm text-white/80 space-y-1 mb-4">
          {stage.outro.map((l, i) => (
            <p key={i}>“{l}”</p>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          <div className="dq-window p-2">
            <div className="text-[10px] text-white/50">LV</div>
            <div className="text-lg font-bold text-dq-gold">{stats.level}</div>
          </div>
          <div className="dq-window p-2">
            <div className="text-[10px] text-white/50">처치</div>
            <div className="text-lg font-bold">{stats.kills}</div>
          </div>
          <div className="dq-window p-2">
            <div className="text-[10px] text-white/50">시간</div>
            <div className="text-lg font-bold">{fmtTime(stats.timeMs)}</div>
          </div>
        </div>
        <button onClick={onNext} className="dq-btn w-full text-lg">
          {next ? `▶ ${next.name} (으)로` : "▶ 계속"}
        </button>
      </div>
    </Backdrop>
  );
}

// ---------- 게임 오버 ----------
export function GameOverScreen({
  stats,
  onContinue,
  onRestart,
  onTitle,
}: {
  stats: RunStats;
  onContinue: () => void;
  onRestart: () => void;
  onTitle: () => void;
}) {
  return (
    <Backdrop>
      <div className="dq-window p-7 text-center w-full max-w-[380px]">
        <h2 className="text-4xl font-black text-red-400 mb-2 text-shadow-hard">
          출근 실패…
        </h2>
        <p className="text-white/70 text-sm mb-1">
          {STAGES[stats.stageReached]?.name}에서 쓰러졌다.
        </p>
        <p className="text-white/50 text-xs mb-5">
          처치 {stats.kills} · LV.{stats.level} · {fmtTime(stats.timeMs)}
        </p>
        <div className="flex flex-col gap-3">
          <button onClick={onContinue} className="dq-btn animate-blink">
            🔁 이어하기 (현재 구역부터)
          </button>
          <button onClick={onRestart} className="dq-btn">
            처음부터
          </button>
          <button onClick={onTitle} className="dq-btn">
            타이틀로
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

// ---------- 최종 승리 ----------
export function VictoryScreen({
  stats,
  onRestart,
  onTitle,
}: {
  stats: RunStats;
  onRestart: () => void;
  onTitle: () => void;
}) {
  const { rank, color, comment } = computeRank(stats);
  return (
    <Backdrop>
      <div className="dq-window p-6 text-center w-full max-w-[520px]">
        <div className="text-dq-gold text-xs tracking-[0.3em] mb-1">CONGRATULATIONS</div>
        <h2 className="text-3xl font-black text-shadow-hard mb-1" style={{ color: "#ffcf4a" }}>
          출근 성공!
        </h2>
        <p className="text-white/70 text-sm mb-4">
          위메이드플레이 도착 — 오늘의 출근 퀘스트 클리어!
        </p>

        <div className="flex items-center justify-center gap-6 mb-4">
          <div>
            <div className="text-[11px] text-white/50 mb-1">RANK</div>
            <div
              className="text-7xl font-black leading-none text-shadow-hard"
              style={{ color }}
            >
              {rank}
            </div>
          </div>
          <div className="text-left text-sm space-y-1.5">
            <div>
              <span className="text-white/50">플레이 타임 </span>
              <span className="font-bold">{fmtTime(stats.timeMs)}</span>
            </div>
            <div>
              <span className="text-white/50">처치 수 </span>
              <span className="font-bold">{stats.kills}</span>
            </div>
            <div>
              <span className="text-white/50">최종 레벨 </span>
              <span className="font-bold">LV.{stats.level}</span>
            </div>
            <div>
              <span className="text-white/50">받은 피해 </span>
              <span className="font-bold">{stats.damageTaken}</span>
            </div>
            <div>
              <span className="text-white/50">컨티뉴 </span>
              <span className="font-bold">{stats.deaths}</span>
            </div>
          </div>
        </div>

        <p className="text-sm mb-5" style={{ color }}>
          “{comment}”
        </p>

        <div className="flex gap-3 justify-center">
          <button onClick={onRestart} className="dq-btn">
            다시 출근하기
          </button>
          <button onClick={onTitle} className="dq-btn">
            타이틀로
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
