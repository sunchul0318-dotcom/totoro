"use client";

import type { HudState } from "@/game/types";

function Bar({
  value,
  max,
  color,
  bg = "rgba(10,12,20,0.7)",
  height = 12,
}: {
  value: number;
  max: number;
  color: string;
  bg?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div
      className="relative w-full rounded-sm overflow-hidden border border-white/60"
      style={{ height, background: bg }}
    >
      <div
        className="h-full transition-[width] duration-150 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// 반투명·컴팩트 패널 (뒤 플레이 화면이 비쳐 보이도록)
const panel =
  "bg-black/35 backdrop-blur-[3px] border border-white/20 rounded-md shadow-[0_2px_0_rgba(0,0,0,0.4)]";

// HUD 는 960x540 스테이지 좌표계에 고정 px 로 배치된다 (스테이지와 함께 스케일됨).
export default function Hud({
  hud,
  onPause,
  muted,
  onToggleMute,
}: {
  hud: HudState;
  onPause: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none text-shadow-hard">
      {/* 좌상단: 스테이터스 (슬림) */}
      <div className={`absolute left-1.5 top-1.5 w-[214px] px-2 py-1.5 ${panel}`}>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[11px] font-bold tracking-widest text-dq-gold">
            LV.{hud.level}
          </span>
          <span className="text-[10px] text-white/80">ATK {hud.atk}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] w-6 text-red-300 font-bold">HP</span>
          <div className="flex-1">
            <Bar value={hud.hp} max={hud.maxHp} color="#e8544f" height={12} />
          </div>
          <span className="text-[9px] text-white/70 tabular-nums w-[52px] text-right">
            {hud.hp}/{hud.maxHp}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[9px] w-6 text-yellow-300 font-bold">SP</span>
          <div className="flex-1">
            <Bar
              value={hud.energy}
              max={hud.maxEnergy}
              color={hud.energy >= hud.maxEnergy ? "#ffcf4a" : "#4a86ff"}
              height={8}
            />
          </div>
          <span className="w-[52px]" />
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[9px] w-6 text-green-300 font-bold">EX</span>
          <div className="flex-1">
            <Bar value={hud.exp} max={hud.expToNext} color="#3fbf8f" height={5} />
          </div>
          <span className="w-[52px]" />
        </div>
      </div>

      {/* 우상단: 스테이지 + 버튼 */}
      <div className="absolute right-1.5 top-1.5 flex items-start gap-1.5">
        <div className={`px-2.5 py-1 text-right ${panel}`}>
          <div className="text-[9px] text-white/60 tracking-widest leading-tight">
            STAGE {hud.stageIndex + 1}/7
          </div>
          <div className="text-[11px] font-bold text-dq-gold leading-tight">
            {hud.stageName}
          </div>
        </div>
        <div className="flex gap-1 pointer-events-auto">
          <button
            onClick={onToggleMute}
            className={`px-1.5 py-1 text-xs active:translate-y-px ${panel}`}
            aria-label="음소거"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            onClick={onPause}
            className={`px-2 py-1 text-xs text-white active:translate-y-px ${panel}`}
            aria-label="일시정지"
          >
            ❚❚
          </button>
        </div>
      </div>

      {/* 중앙 상단: 웨이브/남은 적 (작은 알약) */}
      {!hud.bossName && (
        <div
          className={`absolute left-1/2 top-1.5 -translate-x-1/2 px-2.5 py-0.5 whitespace-nowrap ${panel}`}
        >
          <span className="text-[10px] font-bold tracking-widest text-white/85">
            {hud.waveText}
          </span>
          <span className="ml-2 text-[10px] text-red-300">적 {hud.enemiesLeft}</span>
        </div>
      )}

      {/* 보스 체력바 */}
      {hud.bossName && hud.bossMaxHp ? (
        <div className="absolute left-1/2 top-1.5 -translate-x-1/2 w-[560px]">
          <div className="flex items-center justify-between mb-0.5 px-1">
            <span className="text-xs font-bold text-red-400 tracking-widest">
              👿 {hud.bossName}
            </span>
            <span className="text-[10px] text-white/70">PHASE {hud.bossPhase}/3</span>
          </div>
          <Bar
            value={hud.bossHp ?? 0}
            max={hud.bossMaxHp}
            color="#ff3a3a"
            bg="rgba(42,15,20,0.75)"
            height={14}
          />
        </div>
      ) : null}

      {/* 하단 안내: 버프 (회피 쿨은 표시 생략해 깔끔하게) */}
      {hud.buffTimer > 0 && (
        <div
          className={`absolute left-1.5 bottom-1.5 px-2 py-0.5 text-[10px] text-dq-gold animate-floaty ${panel}`}
        >
          🥤 ATK UP {hud.buffTimer}s
        </div>
      )}
    </div>
  );
}
