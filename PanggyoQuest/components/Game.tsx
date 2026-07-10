"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine } from "@/game/engine";
import { audio } from "@/game/audio";
import { ENDING as ENDING_LINES, OPENING, STAGES } from "@/game/stages";
import type { HudState, RunStats } from "@/game/types";
import { VIEW_H, VIEW_W } from "@/game/constants";
import MessageBox from "./MessageBox";
import Hud from "./Hud";
import TouchControls from "./TouchControls";
import {
  GameOverScreen,
  PauseScreen,
  StageClearScreen,
  TitleScreen,
  VictoryScreen,
} from "./screens";

type Screen =
  | "title"
  | "opening"
  | "stageIntro"
  | "playing"
  | "paused"
  | "stageClear"
  | "gameover"
  | "ending"
  | "victory";

const EMPTY_HUD: HudState = {
  hp: 120,
  maxHp: 120,
  level: 1,
  exp: 0,
  expToNext: 42,
  energy: 0,
  maxEnergy: 100,
  atk: 22,
  combo: 0,
  stageIndex: 0,
  stageName: STAGES[0].name,
  enemiesLeft: 0,
  waveText: "WAVE 1/3",
  buffTimer: 0,
  dodgeReady: true,
};

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const [screen, setScreen] = useState<Screen>("title");
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [stats, setStats] = useState<RunStats>({
    timeMs: 0,
    kills: 0,
    level: 1,
    damageTaken: 0,
    deaths: 0,
    stageReached: 0,
  });
  const [clearedIndex, setClearedIndex] = useState(0);
  const [pendingIntro, setPendingIntro] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const screenRef = useRef<Screen>("title");
  screenRef.current = screen;

  // 엔진 초기화 (마운트 1회)
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onHud: setHud,
      onStageClear: (i) => {
        setStats(engine.getStats());
        setClearedIndex(i);
        setScreen("stageClear");
      },
      onGameOver: (s) => {
        setStats(s);
        setScreen("gameover");
      },
      onVictory: (s) => {
        setStats(s);
        setScreen("ending");
      },
      onLevelUp: () => {},
      onPauseRequest: () => {
        if (screenRef.current === "playing") setScreen("paused");
      },
    });
    engineRef.current = engine;
    engine.attach();
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // 화면 상태에 따른 일시정지 동기화
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPaused(screen !== "playing");
    if (screen === "title") audio.stopBgm();
  }, [screen]);

  // 부모(iframe) 크기에 맞춰 16:9 스테이지를 균일 스케일 (레터박스, 스크롤 없음)
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / VIEW_W, h / VIEW_H));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, []);

  // 모바일 감지
  useEffect(() => {
    const coarse =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ||
        "ontouchstart" in window);
    setIsMobile(!!coarse);
  }, []);

  // ---------- 흐름 제어 ----------
  const startNewRun = useCallback(() => {
    audio.resume();
    engineRef.current?.resetRun();
    setScreen("opening");
  }, []);

  const goToStageIntro = useCallback((i: number) => {
    setPendingIntro(i);
    setScreen("stageIntro");
  }, []);

  const beginCombat = useCallback((i: number) => {
    audio.resume();
    engineRef.current?.loadStage(i);
    setScreen("playing");
  }, []);

  const onOpeningDone = useCallback(() => goToStageIntro(0), [goToStageIntro]);
  const onStageIntroDone = useCallback(
    () => beginCombat(pendingIntro),
    [beginCombat, pendingIntro]
  );

  const onStageClearNext = useCallback(() => {
    const next = clearedIndex + 1;
    if (next < STAGES.length) goToStageIntro(next);
  }, [clearedIndex, goToStageIntro]);

  const onEndingDone = useCallback(() => setScreen("victory"), []);

  const onContinue = useCallback(() => {
    audio.resume();
    engineRef.current?.continueRun();
    setScreen("playing");
  }, []);

  const onRestart = useCallback(() => {
    engineRef.current?.resetRun();
    goToStageIntro(0);
  }, [goToStageIntro]);

  const toTitle = useCallback(() => {
    audio.stopBgm();
    setScreen("title");
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(audio.toggleMute());
  }, []);

  // 터치 입력 → 엔진
  const handleMove = useCallback((x: number, y: number) => {
    engineRef.current?.getInput().setMove(x, y);
  }, []);
  const handleAttack = useCallback(() => engineRef.current?.getInput().pressAttack(), []);
  const handleDodge = useCallback(() => engineRef.current?.getInput().pressDodge(), []);
  const handleSkill = useCallback(() => engineRef.current?.getInput().pressSkill(), []);

  const stageForIntro = STAGES[pendingIntro] ?? STAGES[0];

  return (
    <div
      ref={outerRef}
      className="fixed inset-0 flex h-full w-full items-center justify-center overflow-hidden bg-black"
    >
      {/* 16:9 고정 스테이지 — 부모 크기에 맞춰 통째로 스케일 (캔버스+UI 함께) */}
      <div
        className="crt relative shrink-0 overflow-hidden bg-black"
        style={{
          width: VIEW_W,
          height: VIEW_H,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <canvas
          ref={canvasRef}
          width={VIEW_W}
          height={VIEW_H}
          className="absolute inset-0 h-full w-full"
        />

        {/* HUD: 전투 중에만 */}
        {screen === "playing" && (
          <Hud
            hud={hud}
            onPause={() => setScreen("paused")}
            muted={muted}
            onToggleMute={toggleMute}
          />
        )}

        {/* 오버레이 화면들 */}
        {screen === "title" && <TitleScreen onStart={startNewRun} />}

        {screen === "opening" && (
          <MessageBox lines={OPENING} onDone={onOpeningDone} speaker="이야기" />
        )}

        {screen === "stageIntro" && (
          <MessageBox
            key={`intro-${pendingIntro}`}
            lines={stageForIntro.intro}
            onDone={onStageIntroDone}
            speaker={`제${pendingIntro + 1}구역 · ${stageForIntro.name}`}
            accent={stageForIntro.bg.accent}
          />
        )}

        {screen === "paused" && (
          <PauseScreen onResume={() => setScreen("playing")} onTitle={toTitle} />
        )}

        {screen === "stageClear" && (
          <StageClearScreen
            stageIndex={clearedIndex}
            stats={stats}
            onNext={onStageClearNext}
          />
        )}

        {screen === "gameover" && (
          <GameOverScreen
            stats={stats}
            onContinue={onContinue}
            onRestart={onRestart}
            onTitle={toTitle}
          />
        )}

        {screen === "ending" && (
          <MessageBox
            key="ending"
            lines={[...STAGES[STAGES.length - 1].outro, ...ENDING_LINES]}
            onDone={onEndingDone}
            speaker="에필로그"
            accent="#ffcf4a"
          />
        )}

        {screen === "victory" && (
          <VictoryScreen stats={stats} onRestart={onRestart} onTitle={toTitle} />
        )}
      </div>

      {/* 터치 컨트롤: 스테이지 바깥(비스케일) — 화면이 작아도 손가락 크기 유지 */}
      {screen === "playing" && isMobile && (
        <TouchControls
          onMove={handleMove}
          onAttack={handleAttack}
          onDodge={handleDodge}
          onSkill={handleSkill}
          skillReady={hud.energy >= hud.maxEnergy}
        />
      )}
    </div>
  );
}
