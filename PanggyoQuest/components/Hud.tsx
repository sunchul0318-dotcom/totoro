"use client";

import type { HudState } from "@/game/types";

function Bar({
  value,
  max,
  color,
  bg = "#20242e",
  height = 14,
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
      className="relative w-full rounded-sm overflow-hidden border-2 border-white/80"
      style={{ height, background: bg }}
    >
      <div
        className="h-full transition-[width] duration-150 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

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
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* 좌상단: 스테이터스 */}
      <div className="absolute left-2 top-2 w-[272px] dq-window p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold tracking-widest text-dq-gold">
            LV.{hud.level}
          </span>
          <span className="text-[11px] text-white/70">ATK {hud.atk}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] w-7 text-red-300 font-bold">HP</span>
          <div className="flex-1">
            <Bar value={hud.hp} max={hud.maxHp} color="#e8544f" />
          </div>
        </div>
        <div className="text-right text-[10px] text-white/60 -mt-0.5 mb-1">
          {hud.hp} / {hud.maxHp}
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] w-7 text-yellow-300 font-bold">SP</span>
          <div className="flex-1">
            <Bar
              value={hud.energy}
              max={hud.maxEnergy}
              color={hud.energy >= hud.maxEnergy ? "#ffcf4a" : "#4a86ff"}
              height={10}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] w-7 text-green-300 font-bold">EXP</span>
          <div className="flex-1">
            <Bar value={hud.exp} max={hud.expToNext} color="#3fbf8f" height={7} />
          </div>
        </div>
      </div>

      {/* 우상단: 스테이지/버튼 */}
      <div className="absolute right-2 top-2 flex flex-col items-end gap-1.5">
        <div className="dq-window px-3 py-1.5 text-right">
          <div className="text-[10px] text-white/60 tracking-widest">
            STAGE {hud.stageIndex + 1}/7
          </div>
          <div className="text-sm font-bold text-dq-gold text-shadow-hard">
            {hud.stageName}
          </div>
        </div>
        <div className="flex gap-1.5 pointer-events-auto">
          <button
            onClick={onToggleMute}
            className="dq-btn !px-2.5 !py-1 text-xs"
            aria-label="음소거"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button onClick={onPause} className="dq-btn !px-3 !py-1 text-xs" aria-label="일시정지">
            ❚❚
          </button>
        </div>
      </div>

      {/* 중앙 상단: 웨이브/남은 적 */}
      {!hud.bossName && (
        <div className="absolute left-1/2 top-2 -translate-x-1/2 dq-window px-3 py-1 text-center whitespace-nowrap">
          <span className="text-xs font-bold tracking-widest text-white/90">
            {hud.waveText}
          </span>
          <span className="ml-2 text-xs text-red-300">남은 적 {hud.enemiesLeft}</span>
        </div>
      )}

      {/* 보스 체력바 */}
      {hud.bossName && hud.bossMaxHp ? (
        <div className="absolute left-1/2 top-2 -translate-x-1/2 w-[640px]">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-sm font-bold text-red-400 text-shadow-hard tracking-widest">
              👿 {hud.bossName}
            </span>
            <span className="text-xs text-white/70">PHASE {hud.bossPhase} / 3</span>
          </div>
          <Bar
            value={hud.bossHp ?? 0}
            max={hud.bossMaxHp}
            color="#ff3a3a"
            bg="#2a0f14"
            height={18}
          />
        </div>
      ) : null}

      {/* 하단 안내: 버프/회피 */}
      <div className="absolute left-2 bottom-2 flex gap-2">
        {hud.buffTimer > 0 && (
          <div className="dq-window px-2 py-1 text-[11px] text-dq-gold animate-floaty">
            🥤 ATK UP {hud.buffTimer}s
          </div>
        )}
        {!hud.dodgeReady && (
          <div className="dq-window px-2 py-1 text-[11px] text-white/50">회피 재정비…</div>
        )}
      </div>
    </div>
  );
}
