"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";

interface Props {
  lines: string[];
  onDone: () => void;
  speaker?: string;
  accent?: string;
}

// 드래곤 퀘스트풍 대사창: 타자기 효과 + 한 줄씩 진행
export default function MessageBox({ lines, onDone, speaker, accent = "#ffcf4a" }: Props) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState("");
  const [typing, setTyping] = useState(true);
  const timerRef = useRef<number | null>(null);

  const full = lines[index] ?? "";

  useEffect(() => {
    setShown("");
    setTyping(true);
    let i = 0;
    const tick = () => {
      i++;
      setShown(full.slice(0, i));
      if (i % 2 === 0) audio.play("select");
      if (i >= full.length) {
        setTyping(false);
        if (timerRef.current) window.clearInterval(timerRef.current);
      }
    };
    timerRef.current = window.setInterval(tick, 32);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [full]);

  const advance = useCallback(() => {
    if (typing) {
      // 타이핑 스킵
      setShown(full);
      setTyping(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    audio.play("confirm");
    if (index + 1 < lines.length) {
      setIndex((v) => v + 1);
    } else {
      onDone();
    }
  }, [typing, full, index, lines.length, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "enter" || k === " " || k === "j" || k === "z") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center p-6"
      onClick={advance}
      onTouchStart={(e) => {
        e.preventDefault();
        advance();
      }}
    >
      <div className="dq-window w-full max-w-[760px] p-6 mb-4">
        {speaker && (
          <div
            className="mb-2 text-sm font-bold tracking-widest"
            style={{ color: accent }}
          >
            ▸ {speaker}
          </div>
        )}
        <p className="text-xl leading-relaxed min-h-[2.2em] text-shadow-hard">
          {shown}
          {!typing && <span className="pixel-cursor ml-1">▼</span>}
        </p>
        <div className="mt-3 text-right text-xs text-white/50">
          {index + 1} / {lines.length} · [Enter / 클릭]
        </div>
      </div>
    </div>
  );
}
