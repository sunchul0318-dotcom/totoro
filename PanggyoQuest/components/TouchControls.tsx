"use client";

import { useCallback, useRef, useState } from "react";

interface Props {
  onMove: (x: number, y: number) => void;
  onAttack: () => void;
  onDodge: () => void;
  onSkill: () => void;
  skillReady: boolean;
}

// 모바일 터치 컨트롤: 좌측 가상 조이스틱 + 우측 액션 버튼
export default function TouchControls({
  onMove,
  onAttack,
  onDodge,
  onSkill,
  skillReady,
}: Props) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activePointer = useRef<number | null>(null);
  const RADIUS = 52;

  const updateFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      setKnob({ x: dx, y: dy });
      onMove(dx / RADIUS, dy / RADIUS);
    },
    [onMove]
  );

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    activePointer.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    updateFromEvent(e.clientX, e.clientY);
  };
  const move = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    e.preventDefault();
    updateFromEvent(e.clientX, e.clientY);
  };
  const end = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const actionBtn = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      fn();
    },
  });

  return (
    <div className="absolute inset-0 z-20 pointer-events-none select-none touch-none">
      {/* 조이스틱 */}
      <div
        ref={baseRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="pointer-events-auto absolute bottom-6 left-6 rounded-full border-4 border-white/40 bg-black/30"
        style={{ width: 120, height: 120, touchAction: "none" }}
      >
        <div
          className="absolute rounded-full bg-white/70 border-2 border-white"
          style={{
            width: 52,
            height: 52,
            left: "50%",
            top: "50%",
            transform: `translate(-50%,-50%) translate(${knob.x}px, ${knob.y}px)`,
          }}
        />
      </div>

      {/* 액션 버튼 */}
      <div className="pointer-events-auto absolute bottom-6 right-6 flex items-end gap-3">
        <button
          {...actionBtn(onDodge)}
          className="rounded-full border-4 border-cyan-300/70 bg-cyan-900/50 text-cyan-100 font-bold text-sm active:scale-90 transition"
          style={{ width: 64, height: 64, touchAction: "none" }}
        >
          회피
        </button>
        <button
          {...actionBtn(onSkill)}
          className={`rounded-full border-4 font-bold text-sm active:scale-90 transition ${
            skillReady
              ? "border-yellow-300 bg-yellow-600/60 text-white animate-pulse"
              : "border-white/30 bg-black/40 text-white/40"
          }`}
          style={{ width: 72, height: 72, touchAction: "none" }}
        >
          필살
        </button>
        <button
          {...actionBtn(onAttack)}
          className="rounded-full border-4 border-red-300/80 bg-red-700/60 text-white font-bold text-lg active:scale-90 transition"
          style={{ width: 88, height: 88, touchAction: "none" }}
        >
          공격
        </button>
      </div>
    </div>
  );
}
