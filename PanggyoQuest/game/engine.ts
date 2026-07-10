// ============================================================
// 판교 퀘스트 — 게임 엔진 (Canvas 2D, 실시간 액션)
// 엔티티/전투/AI/렌더/이펙트를 담당한다.
// React 는 화면 전환과 오버레이만 담당하고, 전투 루프는 이 클래스가 소유한다.
// ============================================================

import {
  ARENA_PAD,
  DROP,
  expToNext,
  FX,
  LEVELUP,
  PLAYER,
  STAGE_CLEAR_HEAL,
  VIEW_H,
  VIEW_W,
} from "./constants";
import { ENEMY_DEFS } from "./enemies";
import { InputManager } from "./input";
import { STAGES } from "./stages";
import type {
  EnemyDef,
  EnemyKind,
  EngineEvents,
  HudState,
  RunStats,
  StageDef,
} from "./types";
import { audio } from "./audio";
import {
  angleTo,
  clamp,
  dist,
  inArc,
  lerp,
  rand,
  randInt,
  TAU,
} from "./utils";

interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  baseAtk: number;
  level: number;
  exp: number;
  expToNext: number;
  energy: number;
  facing: number;
  alive: boolean;
  // 타이머(ms, engine time)
  attackReadyAt: number;
  attackActiveUntil: number;
  attackAngle: number;
  attackCombo: number;
  lastAttackAt: number;
  swingHit: Set<number>;
  dodgeReadyAt: number;
  dodgingUntil: number;
  iframeUntil: number;
  dodgeDirX: number;
  dodgeDirY: number;
  skillReadyAt: number;
  buffUntil: number;
  walkPhase: number;
}

interface Enemy {
  id: number;
  kind: EnemyKind;
  def: EnemyDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  radius: number;
  exp: number;
  knockbackResist: number;
  flashUntil: number;
  alive: boolean;
  spawnAnim: number; // 0→1 등장 연출
  // 범용 AI 상태
  t: Record<string, number>;
  st: string;
  bob: number;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  dmg: number;
  color: string;
  life: number;
  maxLife: number;
  fromBoss: boolean;
  spin: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
}

interface DamageNumber {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

interface SlashFx {
  x: number;
  y: number;
  angle: number;
  arc: number;
  reach: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Pickup {
  x: number;
  y: number;
  kind: "coffee" | "energy";
  bob: number;
  life: number;
}

type WavePhase = "spawning" | "fighting" | "cleared";

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private events: EngineEvents;
  private input = new InputManager();

  private raf = 0;
  private lastTime = 0;
  private tMs = 0; // 엔진 내부 경과 시간(ms)
  private running = false;
  paused = true;

  private player!: Player;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private damageNumbers: DamageNumber[] = [];
  private slashes: SlashFx[] = [];
  private pickups: Pickup[] = [];
  private enemyIdSeq = 1;

  private stageIndex = 0;
  private stage!: StageDef;
  private waveIndex = 0;
  private wavePhase: WavePhase = "spawning";
  private waveTimer = 0; // 다음 웨이브 딜레이
  private stageCleared = false;
  private stageActive = false; // 전투 진행중 여부

  // 보스
  private boss: Enemy | null = null;
  private bossPhase = 1;
  private bossInvulnUntil = 0;

  // 화면 흔들림
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private flashAlpha = 0;
  private flashColor = "#ffffff";

  // 통계
  private stats: RunStats = {
    timeMs: 0,
    kills: 0,
    level: 1,
    damageTaken: 0,
    deaths: 0,
    stageReached: 0,
  };
  private runTimeStart = 0;
  private runTimeAccum = 0;

  private hudDirty = 0;

  constructor(canvas: HTMLCanvasElement, events: EngineEvents) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.events = events;
    this.resetRun();
  }

  // ---------- 라이프사이클 ----------
  attach() {
    this.input.attach();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.input.detach();
    audio.stopBgm();
  }

  setPaused(p: boolean) {
    if (p === this.paused) return; // 전이일 때만 시간 정산 (중복 호출 방어)
    this.paused = p;
    if (p) {
      this.runTimeAccum += performance.now() - this.runTimeStart;
    } else {
      this.runTimeStart = performance.now();
    }
  }

  // ---------- 진행 상태 리셋 ----------
  resetRun() {
    const maxHp = PLAYER.baseMaxHp;
    this.player = {
      x: VIEW_W / 2,
      y: VIEW_H / 2 + 80,
      vx: 0,
      vy: 0,
      hp: maxHp,
      maxHp,
      baseAtk: PLAYER.baseAtk,
      level: 1,
      exp: 0,
      expToNext: expToNext(1),
      energy: 0,
      facing: -Math.PI / 2,
      alive: true,
      attackReadyAt: 0,
      attackActiveUntil: 0,
      attackAngle: 0,
      attackCombo: 0,
      lastAttackAt: -9999,
      swingHit: new Set(),
      dodgeReadyAt: 0,
      dodgingUntil: 0,
      iframeUntil: 0,
      dodgeDirX: 0,
      dodgeDirY: 0,
      skillReadyAt: 0,
      buffUntil: 0,
      walkPhase: 0,
    };
    this.stats = {
      timeMs: 0,
      kills: 0,
      level: 1,
      damageTaken: 0,
      deaths: 0,
      stageReached: 0,
    };
    this.runTimeAccum = 0;
    this.runTimeStart = performance.now();
  }

  // ---------- 스테이지 로딩 ----------
  loadStage(index: number) {
    this.stageIndex = clamp(index, 0, STAGES.length - 1);
    this.stage = STAGES[this.stageIndex];
    this.stats.stageReached = Math.max(this.stats.stageReached, this.stageIndex);

    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.damageNumbers = [];
    this.slashes = [];
    this.pickups = [];
    this.boss = null;
    this.bossPhase = 1;

    this.waveIndex = 0;
    this.wavePhase = "spawning";
    this.waveTimer = 0;
    this.stageCleared = false;
    this.stageActive = true;

    // 플레이어 위치 재배치 + 상태 정리
    this.player.x = VIEW_W / 2;
    this.player.y = VIEW_H - ARENA_PAD - 40;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.iframeUntil = this.tMs + 900; // 등장 직후 잠깐 무적
    this.player.dodgingUntil = 0;
    this.player.attackActiveUntil = 0;
    this.player.alive = true;

    this.runTimeStart = performance.now();

    audio.startBgm(this.stage.isBoss ? "boss" : "field");
    if (this.stage.isBoss) audio.play("bossWarn");

    this.spawnWave(0);
    this.pushHud();
  }

  // 죽은 뒤 이어하기: 현재 스테이지 재시작
  continueRun() {
    this.stats.deaths += 1;
    this.player.hp = this.player.maxHp;
    this.player.energy = 0;
    this.loadStage(this.stageIndex);
  }

  // 처음부터
  restartRun() {
    this.resetRun();
    this.loadStage(0);
  }

  advanceStage() {
    if (this.stageIndex + 1 < STAGES.length) {
      this.loadStage(this.stageIndex + 1);
    }
  }

  // ---------- 웨이브/스폰 ----------
  private spawnWave(wi: number) {
    const wave = this.stage.waves[wi];
    if (!wave) return;
    for (const group of wave.spawns) {
      for (let i = 0; i < group.count; i++) {
        this.spawnEnemy(group.kind);
      }
    }
    this.wavePhase = "fighting";
  }

  private edgeSpawnPos(radius: number): { x: number; y: number } {
    // 화면 가장자리에서 스폰, 플레이어와 최소 거리 확보
    for (let tries = 0; tries < 12; tries++) {
      const side = randInt(0, 3);
      let x = 0;
      let y = 0;
      const pad = ARENA_PAD + radius + 6;
      if (side === 0) {
        x = rand(pad, VIEW_W - pad);
        y = pad;
      } else if (side === 1) {
        x = rand(pad, VIEW_W - pad);
        y = VIEW_H - pad;
      } else if (side === 2) {
        x = pad;
        y = rand(pad, VIEW_H - pad);
      } else {
        x = VIEW_W - pad;
        y = rand(pad, VIEW_H - pad);
      }
      if (dist(x, y, this.player.x, this.player.y) > 170) return { x, y };
    }
    return { x: ARENA_PAD + radius, y: ARENA_PAD + radius };
  }

  private spawnEnemy(kind: EnemyKind): Enemy {
    const def = ENEMY_DEFS[kind];
    const s = this.stage;
    const radius = def.radius;
    let x: number;
    let y: number;

    if (kind === "boss") {
      x = VIEW_W / 2;
      y = ARENA_PAD + 90;
    } else if (kind === "escalator") {
      // 수평 라인 왕복
      y = rand(ARENA_PAD + 60, VIEW_H - ARENA_PAD - 60);
      x = Math.random() < 0.5 ? ARENA_PAD + radius : VIEW_W - ARENA_PAD - radius;
    } else if (kind === "badge") {
      // 고정 포탑: 가장자리 안쪽
      const p = this.edgeSpawnPos(radius);
      x = clamp(p.x, VIEW_W * 0.2, VIEW_W * 0.8);
      y = clamp(p.y, VIEW_H * 0.2, VIEW_H * 0.6);
    } else {
      const p = this.edgeSpawnPos(radius);
      x = p.x;
      y = p.y;
    }

    const hpScale = kind === "boss" ? 1 : s.hpScale;
    const maxHp = Math.round(def.hp * hpScale);
    const e: Enemy = {
      id: this.enemyIdSeq++,
      kind,
      def,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: maxHp,
      maxHp,
      atk: def.atk * s.atkScale,
      speed: def.speed * (kind === "boss" ? 1 : s.speedScale),
      radius,
      exp: def.exp,
      knockbackResist: def.knockbackResist,
      flashUntil: 0,
      alive: true,
      spawnAnim: 0,
      t: {},
      st: "",
      bob: rand(0, TAU),
    };

    // 초기 AI 상태
    switch (kind) {
      case "lost":
        e.st = "wander";
        e.t.timer = rand(700, 1500);
        e.t.dir = rand(0, TAU);
        break;
      case "escalator":
        e.t.dir = x < VIEW_W / 2 ? 1 : -1;
        e.t.lineY = y;
        break;
      case "kickboard":
        e.st = "idle";
        e.t.timer = rand(500, 1100);
        break;
      case "signal":
        e.st = "green";
        e.t.phase = rand(1600, 2400);
        e.t.shoot = 900;
        break;
      case "notification":
        e.t.shoot = rand(700, 1400);
        e.t.wob = rand(0, TAU);
        break;
      case "badge":
        e.t.shoot = 1200;
        break;
      case "boss":
        this.boss = e;
        this.bossPhase = 1;
        e.st = "idle";
        e.t.action = 1600;
        e.t.attack = 0;
        this.bossInvulnUntil = this.tMs + 1400;
        break;
    }

    this.enemies.push(e);
    return e;
  }

  // ---------- 메인 루프 ----------
  private loop = (now: number) => {
    if (!this.running) return;
    let dt = now - this.lastTime;
    this.lastTime = now;
    if (dt > 50) dt = 50; // 스파이럴 방지
    if (dt < 0) dt = 0;

    if (!this.paused) {
      this.tMs += dt;
      const dtf = dt / (1000 / 60); // 60fps 기준 프레임 팩터
      this.update(dt, dtf);
    }
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  // ---------- 업데이트 ----------
  private update(dt: number, dtf: number) {
    if (!this.stageActive) return;
    const p = this.player;

    // 입력 처리
    if (this.input.state.pausePressed) {
      this.input.consume();
      // 실제 일시정지는 React가 처리 (엔진 콜백 없음 → HUD 이벤트로 알림)
      this.requestPause();
      return;
    }

    if (p.alive) {
      this.updatePlayer(dt, dtf);
    }
    this.input.consume();

    // 엔티티 갱신
    this.updateEnemies(dt, dtf);
    this.updateProjectiles(dt, dtf);
    this.updateParticles(dtf);
    this.updateDamageNumbers(dtf);
    this.updateSlashes(dt);
    this.updatePickups(dt, dtf);

    // 웨이브 진행 체크
    this.updateWaves(dt);

    // 화면 흔들림 감쇠
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dtf * 0.9);
      this.shakeX = rand(-this.shake, this.shake);
      this.shakeY = rand(-this.shake, this.shake);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (this.flashAlpha > 0) this.flashAlpha = Math.max(0, this.flashAlpha - dt / 260);

    // HUD 갱신(약 20fps로 스로틀)
    this.hudDirty += dt;
    if (this.hudDirty > 60) {
      this.hudDirty = 0;
      this.pushHud();
    }
  }

  private requestPause() {
    this.events.onPauseRequest();
  }

  // ---------- 플레이어 ----------
  private updatePlayer(dt: number, dtf: number) {
    const p = this.player;
    const dodging = this.tMs < p.dodgingUntil;

    // 이동
    const mv = this.input.getMoveVector();
    if (dodging) {
      p.x += p.dodgeDirX * PLAYER.dodgeSpeed * dtf;
      p.y += p.dodgeDirY * PLAYER.dodgeSpeed * dtf;
    } else {
      const spd = PLAYER.speed;
      p.x += mv.x * spd * dtf + p.vx * dtf;
      p.y += mv.y * spd * dtf + p.vy * dtf;
      if (mv.x !== 0 || mv.y !== 0) {
        p.facing = Math.atan2(mv.y, mv.x);
        p.walkPhase += dtf * 0.35;
      }
    }
    // 넉백 감쇠
    p.vx *= Math.pow(0.82, dtf);
    p.vy *= Math.pow(0.82, dtf);

    // 경계
    p.x = clamp(p.x, ARENA_PAD + PLAYER.radius, VIEW_W - ARENA_PAD - PLAYER.radius);
    p.y = clamp(p.y, ARENA_PAD + PLAYER.radius, VIEW_H - ARENA_PAD - PLAYER.radius);

    // 회피
    if (this.input.state.dodgePressed && this.tMs >= p.dodgeReadyAt && !dodging) {
      let dx = mv.x;
      let dy = mv.y;
      if (dx === 0 && dy === 0) {
        dx = Math.cos(p.facing);
        dy = Math.sin(p.facing);
      }
      const len = Math.hypot(dx, dy) || 1;
      p.dodgeDirX = dx / len;
      p.dodgeDirY = dy / len;
      p.dodgingUntil = this.tMs + PLAYER.dodgeDuration;
      p.iframeUntil = this.tMs + PLAYER.dodgeIFrames;
      p.dodgeReadyAt = this.tMs + PLAYER.dodgeCooldown;
      audio.play("dodge");
      this.spawnDust(p.x, p.y, 6);
    }

    // 필살기
    if (
      this.input.state.skillPressed &&
      p.energy >= PLAYER.skillCost &&
      this.tMs >= p.skillReadyAt
    ) {
      this.doSkill();
    }

    // 공격
    if (this.input.state.attackPressed && this.tMs >= p.attackReadyAt && !dodging) {
      this.doAttack(mv);
    }
  }

  private currentAtk(): number {
    const p = this.player;
    let atk = p.baseAtk;
    if (this.tMs < p.buffUntil) atk *= DROP.buffAtkMult;
    return atk;
  }

  private doAttack(mv: { x: number; y: number }) {
    const p = this.player;
    // 콤보 판정
    if (this.tMs - p.lastAttackAt <= PLAYER.comboWindow) {
      p.attackCombo = (p.attackCombo + 1) % PLAYER.comboMax;
    } else {
      p.attackCombo = 0;
    }
    p.lastAttackAt = this.tMs;

    // 이동 입력 방향으로 즉시 방향 전환 (없으면 현재 facing 유지)
    if (mv.x !== 0 || mv.y !== 0) p.facing = Math.atan2(mv.y, mv.x);
    p.attackAngle = p.facing;
    p.attackActiveUntil = this.tMs + PLAYER.attackActive;
    p.attackReadyAt = this.tMs + PLAYER.attackCooldown;
    p.swingHit = new Set();

    const isFinisher = p.attackCombo === PLAYER.comboMax - 1;
    const reach = PLAYER.attackReach * (isFinisher ? 1.28 : 1);
    const halfArc = PLAYER.attackArc / 2;
    const dmgMult = isFinisher ? 1.7 : 1 + p.attackCombo * 0.12;

    // 전방 살짝 전진 (손맛)
    p.vx += Math.cos(p.facing) * (isFinisher ? 3.2 : 1.6);
    p.vy += Math.sin(p.facing) * (isFinisher ? 3.2 : 1.6);

    audio.play("attack");
    this.slashes.push({
      x: p.x,
      y: p.y,
      angle: p.attackAngle,
      arc: PLAYER.attackArc,
      reach,
      life: PLAYER.attackActive,
      maxLife: PLAYER.attackActive,
      color: isFinisher ? "#bff4ff" : "#7ce9ff",
    });

    // 히트 판정
    let hitAny = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > reach + e.radius) continue;
      const ang = angleTo(p.x, p.y, e.x, e.y);
      if (!inArc(ang, p.attackAngle, halfArc)) continue;
      if (p.swingHit.has(e.id)) continue;
      p.swingHit.add(e.id);

      const baseDmg = this.currentAtk() * dmgMult;
      const invuln = this.enemyInvulnerable(e);
      if (invuln) {
        this.damageNumbers.push(this.mkDmg(e.x, e.y - e.radius, "무적", "#8fa1ff", false));
        continue;
      }
      const crit = Math.random() < 0.12;
      const dmg = Math.round(baseDmg * (crit ? 1.8 : 1));
      this.damageEnemy(e, dmg, crit, p.attackAngle, isFinisher ? 12 : 7);
      hitAny = true;
      // 에너지 획득
      p.energy = clamp(p.energy + PLAYER.energyPerHit, 0, PLAYER.skillCost);
    }
    if (hitAny) {
      this.addShake(isFinisher ? FX.shakeHitEnemy + 3 : FX.shakeHitEnemy);
    }
  }

  private doSkill() {
    const p = this.player;
    p.energy = 0;
    p.skillReadyAt = this.tMs + PLAYER.skillCooldown;
    audio.play("skill");
    this.addShake(FX.shakeSkill);
    this.flash("#ffe9b0", 0.5);

    // 링 파티클
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      this.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * rand(4, 9),
        vy: Math.sin(a) * rand(4, 9),
        life: 420,
        maxLife: 420,
        color: i % 2 ? "#ffcf4a" : "#ffffff",
        size: rand(3, 6),
        gravity: 0,
      });
    }
    this.slashes.push({
      x: p.x,
      y: p.y,
      angle: 0,
      arc: TAU,
      reach: PLAYER.skillRadius,
      life: 320,
      maxLife: 320,
      color: "#ffcf4a",
    });

    const dmg = this.currentAtk() * PLAYER.skillDamageMult;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > PLAYER.skillRadius + e.radius) continue;
      if (this.enemyInvulnerable(e)) {
        this.damageNumbers.push(this.mkDmg(e.x, e.y - e.radius, "무적", "#8fa1ff", false));
        continue;
      }
      const ang = angleTo(p.x, p.y, e.x, e.y);
      this.damageEnemy(e, Math.round(dmg), true, ang, 16);
    }
  }

  private enemyInvulnerable(e: Enemy): boolean {
    if (e.kind === "signal") return e.st === "red";
    if (e.kind === "boss") return this.tMs < this.bossInvulnUntil;
    return false;
  }

  private damageEnemy(
    e: Enemy,
    dmg: number,
    crit: boolean,
    fromAngle: number,
    knock: number
  ) {
    e.hp -= dmg;
    e.flashUntil = this.tMs + 90;
    this.damageNumbers.push(
      this.mkDmg(e.x + rand(-6, 6), e.y - e.radius - 4, String(dmg), crit ? "#ffcf4a" : "#ffffff", crit)
    );
    // 넉백
    const k = knock * (1 - e.knockbackResist);
    if (k > 0) {
      e.vx += Math.cos(fromAngle) * k;
      e.vy += Math.sin(fromAngle) * k;
    }
    // 히트 파티클
    this.spawnHitSpark(e.x, e.y, fromAngle, e.def.accent);
    audio.play("enemyHit");

    if (e.hp <= 0) {
      this.killEnemy(e, fromAngle);
    }
  }

  private killEnemy(e: Enemy, fromAngle: number) {
    e.alive = false;
    this.stats.kills += 1;
    audio.play(e.kind === "boss" ? "stageClear" : "enemyDie");
    // 사망 파티클
    for (let i = 0; i < (e.kind === "boss" ? 60 : 14); i++) {
      const a = rand(0, TAU);
      const sp = rand(2, e.kind === "boss" ? 10 : 6);
      this.particles.push({
        x: e.x,
        y: e.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(300, 700),
        maxLife: 700,
        color: Math.random() < 0.5 ? e.def.color : e.def.accent,
        size: rand(2, 5),
        gravity: 0.05,
      });
    }
    this.addShake(e.kind === "boss" ? FX.shakeBoss : FX.shakeHitEnemy + 1);

    if (e.kind === "boss") {
      this.boss = null;
      this.onBossDefeated();
      return;
    }

    // 경험치
    this.gainExp(e.exp);

    // 드롭
    const r = Math.random();
    if (r < DROP.energyDrinkChance) {
      this.pickups.push({ x: e.x, y: e.y, kind: "energy", bob: 0, life: 12000 });
    } else if (r < DROP.energyDrinkChance + DROP.coffeeChance) {
      this.pickups.push({ x: e.x, y: e.y, kind: "coffee", bob: 0, life: 12000 });
    }
  }

  private gainExp(amount: number) {
    const p = this.player;
    p.exp += amount;
    let leveled = false;
    while (p.exp >= p.expToNext) {
      p.exp -= p.expToNext;
      p.level += 1;
      p.maxHp += LEVELUP.hpPerLevel;
      p.baseAtk += LEVELUP.atkPerLevel;
      p.hp = clamp(p.hp + p.maxHp * LEVELUP.healOnLevelUp, 0, p.maxHp);
      p.expToNext = expToNext(p.level);
      leveled = true;
    }
    if (leveled) {
      this.stats.level = p.level;
      audio.play("levelup");
      this.flash("#8fffcf", 0.35);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        this.particles.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(a) * 3,
          vy: Math.sin(a) * 3 - 2,
          life: 600,
          maxLife: 600,
          color: "#8fffcf",
          size: rand(2, 4),
          gravity: -0.02,
        });
      }
      this.damageNumbers.push(this.mkDmg(p.x, p.y - 30, "LEVEL UP!", "#8fffcf", true));
      this.events.onLevelUp(p.level);
    }
  }

  // ---------- 적 AI ----------
  private updateEnemies(dt: number, dtf: number) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.spawnAnim < 1) e.spawnAnim = Math.min(1, e.spawnAnim + dtf * 0.08);
      e.bob += dtf * 0.15;

      // 넉백 속도 적용/감쇠
      e.x += e.vx * dtf;
      e.y += e.vy * dtf;
      e.vx *= Math.pow(0.85, dtf);
      e.vy *= Math.pow(0.85, dtf);

      if (e.kind === "boss") {
        this.updateBoss(e, dt, dtf);
      } else {
        this.updateEnemyAI(e, dt, dtf);
      }

      // 경계 처리
      e.x = clamp(e.x, ARENA_PAD, VIEW_W - ARENA_PAD);
      e.y = clamp(e.y, ARENA_PAD, VIEW_H - ARENA_PAD);

      // 플레이어 접촉 피해
      if (e.spawnAnim >= 0.6) this.tryContactDamage(e);
    }
    // 죽은 적 제거
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  private moveToward(e: Enemy, tx: number, ty: number, mult: number, dtf: number) {
    const a = angleTo(e.x, e.y, tx, ty);
    e.x += Math.cos(a) * e.speed * mult * dtf;
    e.y += Math.sin(a) * e.speed * mult * dtf;
  }

  private updateEnemyAI(e: Enemy, dt: number, dtf: number) {
    const p = this.player;
    switch (e.kind) {
      case "gate":
      case "crowd":
      case "queue": {
        this.moveToward(e, p.x, p.y, 1, dtf);
        break;
      }
      case "lost": {
        e.t.timer -= dt;
        if (e.st === "wander") {
          e.x += Math.cos(e.t.dir) * e.speed * 0.7 * dtf;
          e.y += Math.sin(e.t.dir) * e.speed * 0.7 * dtf;
          if (e.t.timer <= 0) {
            // 가끔 플레이어를 향해 돌진 준비
            if (Math.random() < 0.6) {
              e.st = "aim";
              e.t.timer = 420;
              e.t.dir = angleTo(e.x, e.y, p.x, p.y);
            } else {
              e.t.dir = rand(0, TAU);
              e.t.timer = rand(700, 1400);
            }
          }
        } else if (e.st === "aim") {
          if (e.t.timer <= 0) {
            e.st = "charge";
            e.t.timer = 620;
          }
        } else if (e.st === "charge") {
          e.x += Math.cos(e.t.dir) * e.speed * 3.4 * dtf;
          e.y += Math.sin(e.t.dir) * e.speed * 3.4 * dtf;
          if (e.t.timer <= 0) {
            e.st = "wander";
            e.t.timer = rand(700, 1400);
            e.t.dir = rand(0, TAU);
          }
        }
        break;
      }
      case "escalator": {
        e.x += e.t.dir * e.speed * dtf;
        e.y = lerp(e.y, e.t.lineY, 0.1);
        if (e.x <= ARENA_PAD + e.radius) e.t.dir = 1;
        if (e.x >= VIEW_W - ARENA_PAD - e.radius) e.t.dir = -1;
        break;
      }
      case "kickboard": {
        e.t.timer -= dt;
        if (e.st === "idle") {
          if (e.t.timer <= 0) {
            e.st = "telegraph";
            e.t.timer = 420;
            e.t.dir = angleTo(e.x, e.y, p.x, p.y);
          }
        } else if (e.st === "telegraph") {
          // 예고: 살짝 뒤로 움찔
          e.x -= Math.cos(e.t.dir) * 0.6 * dtf;
          e.y -= Math.sin(e.t.dir) * 0.6 * dtf;
          if (e.t.timer <= 0) {
            e.st = "dash";
            e.t.timer = 520;
            audio.play("dodge");
          }
        } else if (e.st === "dash") {
          e.x += Math.cos(e.t.dir) * e.speed * dtf;
          e.y += Math.sin(e.t.dir) * e.speed * dtf;
          if (
            e.t.timer <= 0 ||
            e.x <= ARENA_PAD + e.radius ||
            e.x >= VIEW_W - ARENA_PAD - e.radius ||
            e.y <= ARENA_PAD + e.radius ||
            e.y >= VIEW_H - ARENA_PAD - e.radius
          ) {
            e.st = "idle";
            e.t.timer = rand(600, 1200);
          }
        }
        break;
      }
      case "signal": {
        e.t.phase -= dt;
        this.moveToward(e, p.x, p.y, e.st === "green" ? 1 : 0.4, dtf);
        if (e.t.phase <= 0) {
          e.st = e.st === "green" ? "red" : "green";
          e.t.phase = e.st === "green" ? rand(1600, 2200) : rand(1800, 2600);
        }
        if (e.st === "red") {
          e.t.shoot -= dt;
          if (e.t.shoot <= 0) {
            e.t.shoot = 700;
            const a = angleTo(e.x, e.y, p.x, p.y);
            this.spawnProjectile(e.x, e.y, a, 3.4, e.atk, "#ff6b6b", false);
          }
        }
        break;
      }
      case "notification": {
        e.t.wob += dtf * 0.08;
        // 플레이어 주변을 맴돌며 접근
        const target = angleTo(e.x, e.y, p.x, p.y) + Math.sin(e.t.wob) * 0.8;
        e.x += Math.cos(target) * e.speed * dtf;
        e.y += Math.sin(target) * e.speed * dtf;
        e.t.shoot -= dt;
        if (e.t.shoot <= 0) {
          e.t.shoot = rand(1100, 1800);
          const a = angleTo(e.x, e.y, p.x, p.y);
          this.spawnProjectile(e.x, e.y, a, 3.2, e.atk, "#ff5d8f", false);
        }
        break;
      }
      case "badge": {
        // 고정 포탑: 링 발사
        e.t.shoot -= dt;
        if (e.t.shoot <= 0) {
          e.t.shoot = 1900;
          const n = 12;
          const off = rand(0, TAU);
          for (let i = 0; i < n; i++) {
            const a = off + (i / n) * TAU;
            this.spawnProjectile(e.x, e.y, a, 2.7, e.atk, "#7c9bff", false);
          }
        }
        break;
      }
    }
  }

  // ---------- 보스 AI (먼데이 모닝) ----------
  private updateBoss(e: Enemy, dt: number, dtf: number) {
    const p = this.player;

    // 페이즈 전환
    const hpRatio = e.hp / e.maxHp;
    if (this.bossPhase === 1 && hpRatio <= 0.66) this.enterBossPhase(2);
    else if (this.bossPhase === 2 && hpRatio <= 0.33) this.enterBossPhase(3);

    if (this.tMs < this.bossInvulnUntil) {
      // 등장/전환 연출 중엔 천천히 부유
      e.y = lerp(e.y, ARENA_PAD + 100, 0.05);
      return;
    }

    e.t.action -= dt;

    if (this.bossPhase === 1) {
      // 데드라인: 추격 + 3방향 사격, 가끔 돌진
      if (e.st === "idle") {
        this.moveToward(e, p.x, p.y, 0.55, dtf);
        if (e.t.action <= 0) {
          e.t.action = rand(1400, 2200);
          if (Math.random() < 0.5) {
            // 3-way "마감" 사격
            const base = angleTo(e.x, e.y, p.x, p.y);
            for (let i = -1; i <= 1; i++) {
              this.spawnProjectile(e.x, e.y, base + i * 0.28, 3.6, e.atk, "#ff5a3a", true);
            }
          } else {
            e.st = "charge_tel";
            e.t.action = 620;
            e.t.dir = angleTo(e.x, e.y, p.x, p.y);
          }
        }
      } else if (e.st === "charge_tel") {
        if (e.t.action <= 0) {
          e.st = "charge";
          e.t.action = 620;
          this.addShake(6);
        }
      } else if (e.st === "charge") {
        e.x += Math.cos(e.t.dir) * 6.5 * dtf;
        e.y += Math.sin(e.t.dir) * 6.5 * dtf;
        if (e.t.action <= 0) {
          e.st = "idle";
          e.t.action = rand(1000, 1600);
        }
      }
    } else if (this.bossPhase === 2) {
      // 긴급회의: 소환 + 링 폭발
      this.moveToward(e, p.x, p.y, 0.35, dtf);
      if (e.t.action <= 0) {
        e.t.action = rand(2200, 3000);
        const roll = Math.random();
        if (roll < 0.45 && this.enemies.length < 9) {
          // 소환: "긴급 소집"
          const k: EnemyKind = Math.random() < 0.5 ? "notification" : "crowd";
          const n = 3;
          for (let i = 0; i < n; i++) this.spawnEnemy(k);
          this.flash("#ffcf4a", 0.25);
          this.damageNumbers.push(this.mkDmg(e.x, e.y - e.radius - 10, "긴급 소집!", "#ffcf4a", true));
        } else {
          // 링 폭발
          const n = 16;
          const off = rand(0, TAU);
          for (let i = 0; i < n; i++) {
            this.spawnProjectile(e.x, e.y, off + (i / n) * TAU, 3.0, e.atk, "#ff5a3a", true);
          }
          this.addShake(8);
        }
      }
    } else {
      // 알림폭탄: 나선 탄막 + 조준 산탄
      this.moveToward(e, p.x, p.y, 0.25, dtf);
      e.t.attack -= dt;
      if (e.t.attack <= 0) {
        e.t.attack = 130;
        e.t.spin = (e.t.spin || 0) + 0.42;
        for (let arm = 0; arm < 3; arm++) {
          const a = e.t.spin + (arm / 3) * TAU;
          this.spawnProjectile(e.x, e.y, a, 3.2, e.atk * 0.8, "#ff8f3a", true);
        }
      }
      if (e.t.action <= 0) {
        e.t.action = rand(1800, 2400);
        // 조준 산탄
        const base = angleTo(e.x, e.y, p.x, p.y);
        for (let i = -2; i <= 2; i++) {
          this.spawnProjectile(e.x, e.y, base + i * 0.16, 4.4, e.atk, "#ff3a3a", true);
        }
        this.addShake(6);
      }
    }
  }

  private enterBossPhase(phase: number) {
    this.bossPhase = phase;
    this.bossInvulnUntil = this.tMs + 1300;
    this.addShake(FX.shakeBoss);
    this.flash("#ff3a3a", 0.6);
    audio.play("bossWarn");
    if (this.boss) {
      this.boss.st = "idle";
      this.boss.t.action = 1200;
      const label = phase === 2 ? "긴급회의 소집!" : "알림 폭탄!!";
      this.damageNumbers.push(this.mkDmg(this.boss.x, this.boss.y - 60, label, "#ff5a5a", true));
    }
  }

  private onBossDefeated() {
    this.flash("#ffffff", 0.9);
    this.addShake(FX.shakeBoss + 6);
    this.stageActive = false;
    this.stageCleared = true;
    // 승리
    audio.stopBgm();
    this.finalizeStatsTime();
    this.events.onVictory({ ...this.stats });
  }

  // ---------- 접촉/투사체 피해 ----------
  private tryContactDamage(e: Enemy) {
    const p = this.player;
    if (!p.alive) return;
    if (this.tMs < p.iframeUntil) return;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > PLAYER.radius + e.radius) return;
    const ang = angleTo(e.x, e.y, p.x, p.y);
    this.hurtPlayer(e.atk, ang);
    // 적도 살짝 튕김(넉백 저항 반영)
    const k = 4 * (1 - e.knockbackResist);
    e.vx -= Math.cos(ang) * k;
    e.vy -= Math.sin(ang) * k;
  }

  private updateProjectiles(dt: number, dtf: number) {
    const p = this.player;
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dtf;
      pr.y += pr.vy * dtf;
      pr.life -= dt;
      pr.spin += dtf * 0.3;
      if (p.alive && this.tMs >= p.iframeUntil) {
        if (dist(pr.x, pr.y, p.x, p.y) <= pr.radius + PLAYER.radius) {
          const ang = angleTo(pr.x, pr.y, p.x, p.y);
          this.hurtPlayer(pr.dmg, ang);
          pr.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter(
      (pr) =>
        pr.life > 0 &&
        pr.x > -20 &&
        pr.x < VIEW_W + 20 &&
        pr.y > -20 &&
        pr.y < VIEW_H + 20
    );
  }

  private spawnProjectile(
    x: number,
    y: number,
    angle: number,
    speed: number,
    dmg: number,
    color: string,
    fromBoss: boolean
  ) {
    this.projectiles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: fromBoss ? 9 : 7,
      dmg: Math.round(dmg),
      color,
      life: 5000,
      maxLife: 5000,
      fromBoss,
      spin: 0,
    });
  }

  private hurtPlayer(dmg: number, fromAngle: number) {
    const p = this.player;
    if (!p.alive) return;
    if (this.tMs < p.iframeUntil) return;
    const d = Math.round(dmg);
    p.hp -= d;
    this.stats.damageTaken += d;
    p.iframeUntil = this.tMs + PLAYER.hurtIFrames;
    p.vx += Math.cos(fromAngle) * PLAYER.hurtKnockback;
    p.vy += Math.sin(fromAngle) * PLAYER.hurtKnockback;
    this.damageNumbers.push(this.mkDmg(p.x, p.y - 26, String(d), "#ff5d5d", true));
    this.addShake(FX.shakeHitPlayer);
    this.flash("#ff2a2a", 0.35);
    audio.play("hurt");
    this.spawnHitSpark(p.x, p.y, fromAngle, "#ff5d5d");
    if (p.hp <= 0) {
      p.hp = 0;
      this.onPlayerDeath();
    }
  }

  private onPlayerDeath() {
    const p = this.player;
    p.alive = false;
    this.stageActive = false;
    audio.stopBgm();
    audio.play("gameover");
    this.addShake(14);
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU);
      this.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * rand(2, 7),
        vy: Math.sin(a) * rand(2, 7),
        life: rand(400, 800),
        maxLife: 800,
        color: Math.random() < 0.5 ? "#ff5d5d" : "#ffffff",
        size: rand(2, 5),
        gravity: 0.05,
      });
    }
    this.finalizeStatsTime();
    this.events.onGameOver({ ...this.stats });
  }

  // ---------- 웨이브 ----------
  private updateWaves(dt: number) {
    if (!this.stageActive || this.stageCleared) return;
    if (this.wavePhase === "fighting") {
      if (this.enemies.length === 0) {
        // 다음 웨이브로
        if (this.waveIndex + 1 < this.stage.waves.length) {
          this.waveIndex += 1;
          const next = this.stage.waves[this.waveIndex];
          this.wavePhase = "spawning";
          this.waveTimer = next.delay ?? 500;
        } else {
          // 스테이지 클리어
          this.onStageComplete();
        }
      }
    } else if (this.wavePhase === "spawning") {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.spawnWave(this.waveIndex);
      }
    }
  }

  private onStageComplete() {
    if (this.stageCleared) return;
    this.stageCleared = true;
    this.stageActive = false;
    audio.play("stageClear");
    // 회복
    this.player.hp = clamp(
      this.player.hp + this.player.maxHp * STAGE_CLEAR_HEAL,
      0,
      this.player.maxHp
    );
    this.finalizeStatsTime();
    this.pushHud();
    this.events.onStageClear(this.stageIndex);
  }

  private finalizeStatsTime() {
    if (this.runTimeStart > 0) {
      this.runTimeAccum += performance.now() - this.runTimeStart;
      this.runTimeStart = performance.now();
    }
    this.stats.timeMs = this.runTimeAccum;
    this.stats.level = this.player.level;
  }

  // ---------- 픽업 ----------
  private updatePickups(dt: number, dtf: number) {
    const p = this.player;
    for (const pk of this.pickups) {
      pk.bob += dtf * 0.12;
      pk.life -= dt;
      if (dist(pk.x, pk.y, p.x, p.y) <= PLAYER.radius + 16) {
        pk.life = 0;
        if (pk.kind === "coffee") {
          this.player.hp = clamp(this.player.hp + DROP.coffeeHeal, 0, this.player.maxHp);
          this.damageNumbers.push(this.mkDmg(p.x, p.y - 30, `+${DROP.coffeeHeal} HP`, "#8fffcf", true));
        } else {
          this.player.buffUntil = this.tMs + DROP.buffDuration;
          this.damageNumbers.push(this.mkDmg(p.x, p.y - 30, "ATK UP!", "#ffcf4a", true));
        }
        audio.play("pickup");
      }
    }
    this.pickups = this.pickups.filter((pk) => pk.life > 0);
  }

  // ---------- 이펙트 유틸 ----------
  private addShake(v: number) {
    this.shake = Math.max(this.shake, v);
  }
  private flash(color: string, alpha: number) {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  private mkDmg(x: number, y: number, text: string, color: string, big: boolean): DamageNumber {
    return {
      x,
      y,
      vy: -1.2,
      text,
      color,
      life: 720,
      maxLife: 720,
      scale: big ? 1.4 : 1,
    };
  }

  private spawnHitSpark(x: number, y: number, angle: number, color: string) {
    for (let i = 0; i < 7; i++) {
      const a = angle + rand(-0.7, 0.7);
      const sp = rand(3, 7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(160, 320),
        maxLife: 320,
        color: Math.random() < 0.5 ? color : "#ffffff",
        size: rand(2, 4),
        gravity: 0.03,
      });
    }
  }

  private spawnDust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * rand(1, 3),
        vy: Math.sin(a) * rand(1, 3),
        life: rand(200, 400),
        maxLife: 400,
        color: "#c8d0e0",
        size: rand(2, 4),
        gravity: 0.02,
      });
    }
  }

  private updateParticles(dtf: number) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dtf;
      pt.y += pt.vy * dtf;
      pt.vy += pt.gravity * dtf;
      pt.vx *= Math.pow(0.94, dtf);
      pt.life -= dtf * (1000 / 60);
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    // 파티클 상한
    if (this.particles.length > 400) {
      this.particles.splice(0, this.particles.length - 400);
    }
  }

  private updateDamageNumbers(dtf: number) {
    for (const d of this.damageNumbers) {
      d.y += d.vy * dtf;
      d.vy *= Math.pow(0.9, dtf);
      d.life -= dtf * (1000 / 60);
    }
    this.damageNumbers = this.damageNumbers.filter((d) => d.life > 0);
  }

  private updateSlashes(dt: number) {
    for (const s of this.slashes) s.life -= dt;
    this.slashes = this.slashes.filter((s) => s.life > 0);
  }

  // ---------- HUD 전달 ----------
  private pushHud() {
    const p = this.player;
    const hud: HudState = {
      hp: Math.ceil(p.hp),
      maxHp: p.maxHp,
      level: p.level,
      exp: Math.floor(p.exp),
      expToNext: p.expToNext,
      energy: Math.floor(p.energy),
      maxEnergy: PLAYER.skillCost,
      atk: Math.round(this.currentAtk()),
      combo: 0,
      stageIndex: this.stageIndex,
      stageName: this.stage?.name ?? "",
      enemiesLeft: this.enemies.filter((e) => e.alive && e.kind !== "boss").length,
      waveText: this.stage
        ? `WAVE ${Math.min(this.waveIndex + 1, this.stage.waves.length)}/${this.stage.waves.length}`
        : "",
      buffTimer: this.tMs < p.buffUntil ? Math.ceil((p.buffUntil - this.tMs) / 1000) : 0,
      dodgeReady: this.tMs >= p.dodgeReadyAt,
    };
    if (this.boss) {
      hud.bossHp = Math.max(0, Math.ceil(this.boss.hp));
      hud.bossMaxHp = this.boss.maxHp;
      hud.bossName = this.boss.def.name;
      hud.bossPhase = this.bossPhase;
    }
    this.events.onHud(hud);
  }

  // 터치 입력 노출
  getInput() {
    return this.input;
  }

  getStats(): RunStats {
    this.finalizeStatsTime();
    return { ...this.stats };
  }

  // ============================================================
  // 렌더링
  // ============================================================
  private render() {
    const ctx = this.ctx;
    if (!this.stage) {
      ctx.fillStyle = "#05060f";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      return;
    }
    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);

    this.drawBackground(ctx);

    // 바닥 그림자 표현을 위해 엔티티는 y정렬
    // 픽업
    for (const pk of this.pickups) this.drawPickup(ctx, pk);
    // 투사체
    for (const pr of this.projectiles) this.drawProjectile(ctx, pr);

    // 적 + 플레이어 y-정렬
    const drawList: { y: number; fn: () => void }[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      drawList.push({ y: e.y, fn: () => this.drawEnemy(ctx, e) });
    }
    if (this.player.alive) {
      drawList.push({ y: this.player.y, fn: () => this.drawPlayer(ctx) });
    }
    drawList.sort((a, b) => a.y - b.y);
    for (const d of drawList) d.fn();

    // 슬래시/스킬
    for (const s of this.slashes) this.drawSlash(ctx, s);
    // 파티클
    for (const pt of this.particles) this.drawParticle(ctx, pt);
    // 데미지 숫자
    for (const d of this.damageNumbers) this.drawDamageNumber(ctx, d);

    ctx.restore();

    // 화면 플래시(흔들림 영향 없이 전체)
    if (this.flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(this.flashAlpha, 0, 1);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    // 비네트
    this.drawVignette(ctx);
  }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    const bg = this.stage?.bg;
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, bg?.top ?? "#0a1020");
    grad.addColorStop(1, bg?.bottom ?? "#05060f");
    ctx.fillStyle = grad;
    ctx.fillRect(-40, -40, VIEW_W + 80, VIEW_H + 80);

    // 바닥 (원근 그리드)
    ctx.fillStyle = bg?.floor ?? "#141c30";
    ctx.fillRect(-40, VIEW_H * 0.32, VIEW_W + 80, VIEW_H);

    ctx.strokeStyle = bg?.grid ?? "#24406e";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    const horizon = VIEW_H * 0.32;
    // 세로선(원근 수렴)
    for (let i = -8; i <= 8; i++) {
      const bx = VIEW_W / 2 + i * 70;
      ctx.beginPath();
      ctx.moveTo(VIEW_W / 2 + i * 8, horizon);
      ctx.lineTo(bx, VIEW_H);
      ctx.stroke();
    }
    // 가로선
    for (let j = 0; j < 8; j++) {
      const t = j / 8;
      const y = horizon + Math.pow(t, 1.8) * (VIEW_H - horizon);
      ctx.beginPath();
      ctx.moveTo(-40, y);
      ctx.lineTo(VIEW_W + 40, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 아레나 경계 프레임
    ctx.strokeStyle = bg?.accent ?? "#ffcf4a";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.strokeRect(
      ARENA_PAD - 6,
      ARENA_PAD - 6,
      VIEW_W - (ARENA_PAD - 6) * 2,
      VIEW_H - (ARENA_PAD - 6) * 2
    );
    ctx.globalAlpha = 1;

    // 바닥 컨셉 소품 (엔티티 뒤, 낮은 투명도)
    this.drawFloorProps(ctx);

    // 목적지 표식(회사 방향) — 상단 중앙에 픽셀 화살표/건물
    this.drawStageDecor(ctx);
  }

  // 원근 바닥 좌표: nx(중앙 기준 i단위), t(수평선 0 → 바닥 1)
  private floorPoint(nx: number, t: number): { x: number; y: number } {
    const hz = this.horizonY;
    const y = hz + Math.pow(t, 1.8) * (VIEW_H - hz);
    const xs = lerp(8, 70, t);
    return { x: VIEW_W / 2 + nx * xs, y };
  }

  private drawFloorProps(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    switch (this.stageIndex) {
      case 0: {
        // 승강장: 노란 안전선 + 탑승 위치 마커
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#ffcf4a";
        for (let t = 0.15; t < 1; t += 0.16) {
          const a = this.floorPoint(-7, t);
          const b = this.floorPoint(7, t);
          ctx.fillRect(a.x, a.y - 1, b.x - a.x, 2);
        }
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#ffcf4a";
        for (const nx of [-4, -1.3, 1.3, 4]) {
          const p = this.floorPoint(nx, 0.55);
          ctx.fillText("▷", p.x - 5, p.y);
        }
        ctx.restore();
        break;
      }
      case 1: {
        // 터널: 전진 셰브런 + 측면 배수로
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = "#8f7fc0";
        ctx.font = "bold 22px 'Courier New', monospace";
        ctx.textAlign = "center";
        for (let t = 0.2; t < 1; t += 0.2) {
          const p = this.floorPoint(0, t);
          ctx.globalAlpha = 0.1 + t * 0.18;
          ctx.fillText("▲", p.x, p.y);
        }
        ctx.restore();
        break;
      }
      case 2: {
        // 지상: 보도 블록 이음새 + 은은한 빛무리
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = "#cdd8f0";
        ctx.lineWidth = 1;
        for (let t = 0.1; t < 1; t += 0.14) {
          const a = this.floorPoint(-9, t);
          const b = this.floorPoint(9, t);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const g = ctx.createRadialGradient(VIEW_W / 2, hz + 40, 10, VIEW_W / 2, hz + 40, 320);
        g.addColorStop(0, "rgba(255,242,176,0.18)");
        g.addColorStop(1, "rgba(255,242,176,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, hz, VIEW_W, VIEW_H - hz);
        ctx.restore();
        break;
      }
      case 3: {
        // 횡단보도: 정지선 + 중앙 차선 점선
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#f4f4ff";
        const s = this.floorPoint(-8, 0.12);
        const e = this.floorPoint(8, 0.12);
        ctx.fillRect(s.x, s.y - 2, e.x - s.x, 5);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#ffcf4a";
        for (let t = 0.25; t < 1; t += 0.18) {
          const p = this.floorPoint(0, t);
          const w = lerp(3, 14, t);
          ctx.fillRect(p.x - w / 2, p.y - lerp(4, 16, t) / 2, w, lerp(4, 16, t));
        }
        ctx.restore();
        break;
      }
      case 4: {
        // 카페 보도: 테이블/의자 실루엣 (가장자리)
        ctx.save();
        const spots: [number, number][] = [
          [-6.5, 0.35],
          [6.5, 0.4],
          [-8, 0.7],
          [8, 0.72],
        ];
        for (const [nx, t] of spots) {
          const p = this.floorPoint(nx, t);
          const r = lerp(6, 16, t);
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = "#2a1c12";
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "#5a3f28";
          ctx.beginPath();
          ctx.arc(p.x, p.y - r * 0.3, r * 0.55, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 0.5;
          ctx.font = `${Math.round(r * 0.9)}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("☕", p.x, p.y - r * 0.3);
        }
        ctx.restore();
        break;
      }
      case 5: {
        // 로비: 대리석 광택 대각선 + 바닥 로고 링
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = "#bcd2ff";
        ctx.beginPath();
        ctx.moveTo(0, hz + 30);
        ctx.lineTo(VIEW_W * 0.5, hz);
        ctx.lineTo(VIEW_W, hz + 120);
        ctx.lineTo(VIEW_W, hz + 220);
        ctx.lineTo(0, hz + 130);
        ctx.closePath();
        ctx.fill();
        const c = this.floorPoint(0, 0.62);
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = "#4a86ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 70, 30, 0, 0, TAU);
        ctx.stroke();
        this.text(ctx, "WMP", c.x, c.y, 20, "#4a86ff", 0.2);
        ctx.restore();
        break;
      }
      case 6: {
        // 사무실: 보스 하단 스포트라이트 + 흩어진 서류
        ctx.save();
        const c = this.floorPoint(0, 0.28);
        const g = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, 220);
        g.addColorStop(0, "rgba(255,58,58,0.16)");
        g.addColorStop(1, "rgba(255,58,58,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, hz, VIEW_W, VIEW_H - hz);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#d8d8e8";
        const papers: [number, number][] = [
          [-5, 0.5],
          [4, 0.6],
          [-7, 0.8],
          [6.5, 0.85],
          [1.5, 0.42],
        ];
        for (const [nx, t] of papers) {
          const p = this.floorPoint(nx, t);
          const w = lerp(6, 16, t);
          ctx.fillRect(p.x - w / 2, p.y - w * 0.35, w, w * 0.7);
        }
        ctx.restore();
        break;
      }
    }
  }

  private drawStageDecor(ctx: CanvasRenderingContext2D) {
    // 스테이지 컨셉 배경 아트 (원경 → 근경 순)
    switch (this.stageIndex) {
      case 0:
        this.sceneStation(ctx);
        break;
      case 1:
        this.sceneTunnel(ctx);
        break;
      case 2:
        this.sceneExitStairs(ctx);
        break;
      case 3:
        this.sceneCrosswalk(ctx);
        break;
      case 4:
        this.sceneCafeStreet(ctx);
        break;
      case 5:
        this.sceneLobby(ctx);
        break;
      case 6:
        this.sceneBossOffice(ctx);
        break;
    }
  }

  private get horizonY() {
    return VIEW_H * 0.32;
  }

  // 배경 뒷벽(수평선 위) 공통 밴드
  private backWall(ctx: CanvasRenderingContext2D, color: string, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(-40, -40, VIEW_W + 80, this.horizonY + 40);
    ctx.restore();
  }

  private text(
    ctx: CanvasRenderingContext2D,
    t: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha = 1
  ) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, x, y);
    ctx.restore();
  }

  // ── 스테이지 1: 판교역 개찰구 ──
  private sceneStation(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    this.backWall(ctx, "#0d1830", 0.9);
    // 타일 벽
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#24406e";
    ctx.lineWidth = 1;
    for (let y = 10; y < hz; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
      ctx.stroke();
    }
    for (let x = 0; x < VIEW_W; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, hz);
      ctx.stroke();
    }
    ctx.restore();
    // 천장 조명
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#fff6cf";
    for (let i = 0; i < 6; i++) ctx.fillRect(70 + i * 140, 8, 60, 5);
    ctx.restore();
    // 역명판 (신분당선 레드 스트라이프)
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#0a0f1e";
    this.roundRect(ctx, VIEW_W / 2 - 130, 34, 260, 46, 6);
    ctx.fill();
    ctx.strokeStyle = "#e8544f";
    ctx.lineWidth = 4;
    this.roundRect(ctx, VIEW_W / 2 - 130, 34, 260, 46, 6);
    ctx.stroke();
    ctx.restore();
    this.text(ctx, "🚇 판교  PANGYO", VIEW_W / 2, 57, 20, "#ffffff", 0.95);
    // 개찰구(턴스타일) 줄지어
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const x = 130 + i * 165;
      const y = hz - 34;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#3a4a6e";
      this.roundRect(ctx, x - 26, y, 52, 40, 4);
      ctx.fill();
      // 통과 바
      ctx.fillStyle = "#1a2440";
      ctx.fillRect(x - 22, y + 6, 44, 8);
      // 신호등 (초/적 교대)
      const green = Math.floor(this.tMs / 900 + i) % 2 === 0;
      ctx.fillStyle = green ? "#4bff8f" : "#ff5a5a";
      ctx.beginPath();
      ctx.arc(x, y + 26, 5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // 바닥 안전선 (노란 라인)
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ffcf4a";
    ctx.fillRect(-40, hz + 26, VIEW_W + 80, 6);
    ctx.restore();
  }

  // ── 스테이지 2: 지하 환승 통로 ──
  private sceneTunnel(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    this.backWall(ctx, "#120e1c", 0.92);
    // 원근 터널 아치
    ctx.save();
    ctx.strokeStyle = "#5a4780";
    for (let i = 6; i >= 1; i--) {
      const t = i / 6;
      const w = 120 + t * 620;
      const h = 60 + t * 210;
      ctx.globalAlpha = 0.14 + (1 - t) * 0.28;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(VIEW_W / 2, hz + 20, w / 2, h, 0, Math.PI, TAU);
      ctx.stroke();
    }
    ctx.restore();
    // 천장 배관
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = "#6e6480";
    ctx.lineWidth = 4;
    for (let k = 0; k < 3; k++) {
      const y = 14 + k * 12;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
      ctx.stroke();
    }
    // 형광등
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#cfe0ff";
    for (let i = 0; i < 7; i++) ctx.fillRect(50 + i * 120, 44, 46, 4);
    ctx.restore();
    // 환승 표지판
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#1f6b3a";
    this.roundRect(ctx, VIEW_W / 2 - 120, 60, 240, 40, 5);
    ctx.fill();
    ctx.restore();
    this.text(ctx, "◀ 환승  TRANSFER ▶", VIEW_W / 2, 80, 17, "#eafff2", 0.95);
  }

  // ── 스테이지 3: 지상 출구 계단 ──
  private sceneExitStairs(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    // 하늘
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, "#5b74b0");
    sky.addColorStop(1, "#9fb4dc");
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = sky;
    ctx.fillRect(-40, -40, VIEW_W + 80, hz + 40);
    ctx.restore();
    // 태양 + 광선
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#fff2b0";
    ctx.beginPath();
    ctx.arc(VIEW_W - 90, 40, 30, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#fff2b0";
    ctx.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + this.tMs / 4000;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.moveTo(VIEW_W - 90, 40);
      ctx.lineTo(VIEW_W - 90 + Math.cos(a) * 120, 40 + Math.sin(a) * 120);
      ctx.stroke();
    }
    ctx.restore();
    // 나무 실루엣
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#20402c";
    for (const tx of [60, 150, VIEW_W - 200, VIEW_W - 60]) {
      ctx.fillRect(tx - 4, hz - 40, 8, 40);
      ctx.beginPath();
      ctx.arc(tx, hz - 46, 22, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // 오르는 계단 (중앙)
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const w = 220 - i * 26;
      const y = hz - 8 - i * 11;
      ctx.globalAlpha = 0.5 - i * 0.03;
      ctx.fillStyle = "#8a97b8";
      ctx.fillRect(VIEW_W / 2 - w / 2, y, w, 9);
    }
    ctx.restore();
    // EXIT 표지
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#1f6b3a";
    this.roundRect(ctx, VIEW_W / 2 - 70, 20, 140, 34, 5);
    ctx.fill();
    ctx.restore();
    this.text(ctx, "출구 ↑ EXIT", VIEW_W / 2, 37, 16, "#eafff2", 0.95);
  }

  // ── 스테이지 4: 죽음의 횡단보도 ──
  private sceneCrosswalk(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    // 하늘 + 원경 빌딩
    ctx.save();
    ctx.globalAlpha = 0.85;
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, "#1c2a4a");
    sky.addColorStop(1, "#39507e");
    ctx.fillStyle = sky;
    ctx.fillRect(-40, -40, VIEW_W + 80, hz + 40);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < 8; i++) {
      const w = 50 + ((i * 41) % 46);
      const h = 44 + ((i * 61) % 86);
      const x = 20 + i * 112;
      ctx.fillStyle = i % 2 ? "#2a3860" : "#233152";
      ctx.fillRect(x, hz - h, w, h);
      // 창문
      ctx.fillStyle = "#ffd86e";
      for (let wy = hz - h + 8; wy < hz - 6; wy += 12)
        for (let wx = x + 6; wx < x + w - 6; wx += 12)
          if ((wx + wy) % 3 === 0) ctx.fillRect(wx, wy, 4, 5);
    }
    ctx.restore();
    // 횡단보도 (원근 얼룩말 줄무늬) — 바닥
    ctx.save();
    const cx = VIEW_W / 2;
    for (let i = -6; i <= 6; i += 2) {
      const topX = cx + i * 9;
      const botX = cx + i * 74;
      const topX2 = cx + (i + 1) * 9;
      const botX2 = cx + (i + 1) * 74;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#f4f4ff";
      ctx.beginPath();
      ctx.moveTo(topX, hz + 8);
      ctx.lineTo(topX2, hz + 8);
      ctx.lineTo(botX2, VIEW_H);
      ctx.lineTo(botX, VIEW_H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // 신호등 기둥 (좌우)
    for (const sx of [70, VIEW_W - 70]) {
      const red = Math.floor(this.tMs / 1400) % 2 === 0;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#2a2f3a";
      ctx.fillRect(sx - 3, 40, 6, hz - 40);
      ctx.fillStyle = "#12151d";
      this.roundRect(ctx, sx - 14, 40, 28, 56, 4);
      ctx.fill();
      ctx.fillStyle = red ? "#ff3a3a" : "#3a1010";
      ctx.beginPath();
      ctx.arc(sx, 56, 8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = !red ? "#4bff8f" : "#0f2a18";
      ctx.beginPath();
      ctx.arc(sx, 80, 8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── 스테이지 5: 카페거리 ──
  private sceneCafeStreet(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    this.backWall(ctx, "#241a12", 0.92);
    // 상점 파사드
    const shops = ["CAFE ☕", "BAKERY 🥐", "위메이드 ▲", "BRUNCH 🍳"];
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 220;
      const w = 200;
      // 건물
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = i % 2 ? "#3a2a1e" : "#463322";
      ctx.fillRect(x, 20, w, hz - 20);
      // 창/문
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#1a120c";
      ctx.fillRect(x + 20, hz - 70, w - 40, 60);
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = "#ffcf8a";
      ctx.fillRect(x + 26, hz - 64, w - 52, 30);
      // 차양 (줄무늬)
      for (let s = 0; s < 8; s++) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = s % 2 ? "#c94f4f" : "#f0e6d8";
        ctx.fillRect(x + 8 + s * ((w - 16) / 8), hz - 92, (w - 16) / 8, 20);
      }
      // 간판
      ctx.globalAlpha = 0.95;
      this.text(ctx, shops[i], x + w / 2, 40, 15, "#ffe6b0", 1);
    }
    ctx.restore();
    // 전구 스트링 라이트 (반짝)
    ctx.save();
    ctx.strokeStyle = "#8a6a4a";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= VIEW_W; x += 10)
      ctx.lineTo(x, 60 + Math.sin(x / 60) * 10);
    ctx.stroke();
    for (let x = 20; x < VIEW_W; x += 40) {
      const y = 60 + Math.sin(x / 60) * 10 + 6;
      const tw = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(this.tMs / 300 + x));
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#ffdf7a";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── 스테이지 6: 위메이드플레이 로비 ──
  private sceneLobby(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    this.backWall(ctx, "#0a1526", 0.94);
    // 유리 커튼월 (멀리언)
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#12233f";
    ctx.fillRect(-40, 0, VIEW_W + 80, hz);
    ctx.strokeStyle = "#3a5f9e";
    ctx.lineWidth = 1;
    for (let x = 0; x < VIEW_W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, hz);
      ctx.stroke();
    }
    for (let y = 24; y < hz; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
      ctx.stroke();
    }
    ctx.restore();
    // 로고 패널
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#0e1c33";
    this.roundRect(ctx, VIEW_W / 2 - 150, 26, 300, 44, 6);
    ctx.fill();
    ctx.strokeStyle = "#2a5cff";
    ctx.lineWidth = 3;
    this.roundRect(ctx, VIEW_W / 2 - 150, 26, 300, 44, 6);
    ctx.stroke();
    ctx.restore();
    this.text(ctx, "▲ WEMADE PLAY", VIEW_W / 2, 49, 20, "#7fb0ff", 1);
    // 엘리베이터 2기
    ctx.save();
    for (const ex of [VIEW_W / 2 - 90, VIEW_W / 2 + 90]) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = "#2a3b5a";
      this.roundRect(ctx, ex - 34, hz - 78, 68, 78, 4);
      ctx.fill();
      // 문 틈
      ctx.strokeStyle = "#8fb0e0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex, hz - 74);
      ctx.lineTo(ex, hz - 4);
      ctx.stroke();
      // 층 표시
      ctx.fillStyle = "#ff9a3a";
      ctx.globalAlpha = 0.9;
      this.text(ctx, "▲", ex, hz - 70, 12, "#ffcf4a", 1);
    }
    ctx.restore();
    // 리셉션 데스크 실루엣
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#182a48";
    this.roundRect(ctx, VIEW_W / 2 - 70, hz - 6, 140, 22, 6);
    ctx.fill();
    ctx.restore();
  }

  // ── 스테이지 7: 최상층 보스 (어둠의 사무실) ──
  private sceneBossOffice(ctx: CanvasRenderingContext2D) {
    const hz = this.horizonY;
    this.backWall(ctx, "#0a0512", 0.95);
    // 야경 창문 (스카이라인)
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 9; i++) {
      const w = 44 + ((i * 37) % 40);
      const h = 50 + ((i * 59) % 80);
      const x = 10 + i * 100;
      ctx.fillStyle = "#0f0a22";
      ctx.fillRect(x, hz - h, w, h);
      ctx.fillStyle = "#3a2a6a";
      for (let wy = hz - h + 6; wy < hz - 6; wy += 10)
        for (let wx = x + 5; wx < x + w - 5; wx += 10)
          if ((wx * 3 + wy) % 4 === 0) ctx.fillRect(wx, wy, 4, 5);
    }
    ctx.restore();
    // 붉은 비상등 맥동
    ctx.save();
    const pulse = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(this.tMs / 220));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#ff2a2a";
    ctx.fillRect(-40, -40, VIEW_W + 80, hz + 40);
    ctx.restore();
    // 큐비클 책상 + 모니터 글로우
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 190;
      const y = hz - 26;
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#14102a";
      ctx.fillRect(x - 30, y, 60, 26);
      // 모니터
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#0a0820";
      ctx.fillRect(x - 16, y - 20, 32, 18);
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.tMs / 400 + i);
      ctx.fillStyle = i % 2 ? "#3a6aff" : "#2affa0";
      ctx.fillRect(x - 13, y - 17, 26, 12);
    }
    ctx.restore();
    // 벽 달력 "MON" + 시계
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#f4f4ff";
    this.roundRect(ctx, 60, 30, 70, 56, 5);
    ctx.fill();
    ctx.fillStyle = "#ff3a3a";
    ctx.fillRect(60, 30, 70, 18);
    ctx.restore();
    this.text(ctx, "MON", 95, 39, 12, "#fff", 1);
    this.text(ctx, "9:00", 95, 66, 20, "#1a1030", 1);
    // 시계
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = "#ffcf4a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(VIEW_W - 80, 56, 24, 0, TAU);
    ctx.stroke();
    const ang = this.tMs / 600;
    ctx.beginPath();
    ctx.moveTo(VIEW_W - 80, 56);
    ctx.lineTo(VIEW_W - 80 + Math.cos(ang) * 16, 56 + Math.sin(ang) * 16);
    ctx.moveTo(VIEW_W - 80, 56);
    ctx.lineTo(VIEW_W - 80 + Math.cos(ang * 12) * 10, 56 + Math.sin(ang * 12) * 10);
    ctx.stroke();
    ctx.restore();
  }

  private drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.72, r * 0.95, r * 0.4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 콘셉트 아트의 히어로: 갈색 스파이크 머리 · 베이지 후드 자켓 · 청바지 · WP 백팩 · 빛나는 파란 검
  private drawHeroSword(ctx: CanvasRenderingContext2D, facing: number, attacking: boolean) {
    const r = PLAYER.radius;
    ctx.save();
    ctx.rotate(facing);
    const len = attacking ? 30 : 20;
    const bx = r - 1;
    // 발광
    ctx.shadowColor = "#4ad8ff";
    ctx.shadowBlur = attacking ? 18 : 9;
    // 검신 (크리스탈 다이아 형태)
    ctx.fillStyle = "#4ad8ff";
    ctx.beginPath();
    ctx.moveTo(bx, -3.6);
    ctx.lineTo(bx + len - 7, -3);
    ctx.lineTo(bx + len, 0);
    ctx.lineTo(bx + len - 7, 3);
    ctx.lineTo(bx, 3.6);
    ctx.closePath();
    ctx.fill();
    // 코어 하이라이트
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#eafcff";
    ctx.fillRect(bx, -1.1, len - 7, 2.2);
    // 가드(금색) + 손잡이
    ctx.fillStyle = "#ffcf4a";
    ctx.fillRect(bx - 4, -4.5, 4, 9);
    ctx.fillStyle = "#6e4a2e";
    ctx.fillRect(bx - 9, -1.6, 5, 3.2);
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    const dodging = this.tMs < p.dodgingUntil;
    const invuln = this.tMs < p.iframeUntil;
    const attacking = this.tMs < p.attackActiveUntil;
    const r = PLAYER.radius;
    // 위쪽을 볼 땐 검을 몸 뒤에 그려 자연스럽게
    const swordBehind = Math.sin(p.facing) < -0.25;

    this.drawShadow(ctx, p.x, p.y, r);

    ctx.save();
    ctx.translate(p.x, p.y);
    if (invuln && !dodging && Math.floor(this.tMs / 70) % 2 === 0) {
      ctx.globalAlpha = 0.5;
    }
    if (dodging) {
      const t = 1 - (p.dodgingUntil - this.tMs) / PLAYER.dodgeDuration;
      ctx.rotate(t * TAU * (p.dodgeDirX >= 0 ? 1 : -1));
    }

    const bob = Math.sin(p.walkPhase) * 1.4;

    if (swordBehind) this.drawHeroSword(ctx, p.facing, attacking);

    // 다리 (청바지) + 스니커즈
    ctx.fillStyle = "#33517f";
    ctx.fillRect(-7, 8 + bob, 6, 8);
    ctx.fillRect(1, 8 + bob, 6, 8);
    ctx.fillStyle = "#eef0f5";
    ctx.fillRect(-8, 14 + bob, 7, 3);
    ctx.fillRect(1, 14 + bob, 7, 3);

    // 백팩 (어깨 뒤로 살짝) + 스트랩
    ctx.fillStyle = "#6e4a2e";
    ctx.fillRect(-8.5, -5 + bob, 3, 15);
    ctx.fillRect(5.5, -5 + bob, 3, 15);

    // 몸통 (베이지 후드 자켓)
    ctx.fillStyle = "#c9a06a";
    this.roundRect(ctx, -10, -6 + bob, 20, 17, 5);
    ctx.fill();
    // 후드 칼라
    ctx.fillStyle = "#a87f4c";
    this.roundRect(ctx, -8, -8 + bob, 16, 5, 3);
    ctx.fill();
    // 흰 티셔츠 V
    ctx.fillStyle = "#f2f2f5";
    ctx.beginPath();
    ctx.moveTo(-4, -5 + bob);
    ctx.lineTo(0, 3 + bob);
    ctx.lineTo(4, -5 + bob);
    ctx.closePath();
    ctx.fill();
    // WP 뱃지 (가슴)
    ctx.fillStyle = "#2a5cff";
    this.roundRect(ctx, -3, 0 + bob, 6, 5, 1);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 4px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("W", 0, 2.6 + bob);

    // 머리
    ctx.fillStyle = "#ffcf9e";
    ctx.beginPath();
    ctx.arc(0, -14 + bob, 8, 0, TAU);
    ctx.fill();
    // 갈색 스파이크 머리카락
    ctx.fillStyle = "#7a4a1e";
    ctx.beginPath();
    ctx.arc(0, -15 + bob, 8, Math.PI, TAU);
    ctx.fill();
    for (let i = -2; i <= 2; i++) {
      const tipH = 21 + (2 - Math.abs(i)) * 2; // 가운데가 더 높은 프린지
      ctx.beginPath();
      ctx.moveTo(i * 3 - 2, -19 + bob);
      ctx.lineTo(i * 3 + 2, -tipH + bob); // 살짝 오른쪽으로 쓸어올림
      ctx.lineTo(i * 3 + 3, -19 + bob);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(-8, -16 + bob, 16, 3);
    // 눈 (방향 표시, 결의에 찬 표정)
    ctx.fillStyle = "#20242e";
    const ex = Math.cos(p.facing) * 2.2;
    ctx.fillRect(-4 + ex, -15 + bob, 2.4, 2.4);
    ctx.fillRect(2 + ex, -15 + bob, 2.4, 2.4);

    if (!swordBehind) this.drawHeroSword(ctx, p.facing, attacking);

    ctx.restore();

    // 버프 오라
    if (this.tMs < p.buffUntil) {
      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(this.tMs / 120) * 0.15;
      ctx.strokeStyle = "#ffcf4a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 8, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 화난 눈 + 눈썹 (몬스터 공용 표정)
  private angryEyes(
    ctx: CanvasRenderingContext2D,
    y: number,
    spread: number,
    size: number,
    out: string,
    sclera: string
  ) {
    ctx.fillStyle = sclera;
    ctx.beginPath();
    ctx.arc(-spread, y, size, 0, TAU);
    ctx.arc(spread, y, size, 0, TAU);
    ctx.fill();
    ctx.fillStyle = out;
    ctx.beginPath();
    ctx.arc(-spread, y + size * 0.25, size * 0.55, 0, TAU);
    ctx.arc(spread, y + size * 0.25, size * 0.55, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = out;
    ctx.lineWidth = Math.max(2, size * 0.55);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-spread - size, y - size * 1.35);
    ctx.lineTo(-spread + size, y - size * 0.3);
    ctx.moveTo(spread + size, y - size * 1.35);
    ctx.lineTo(spread - size, y - size * 0.3);
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy) {
    const flash = this.tMs < e.flashUntil;
    const scale = lerp(0.3, 1, e.spawnAnim);
    const r = e.radius;
    const bobY = Math.sin(e.bob) * (e.kind === "notification" ? 4 : 2);

    this.drawShadow(ctx, e.x, e.y, r * scale);

    ctx.save();
    ctx.translate(e.x, e.y + bobY);
    ctx.scale(scale, scale);
    if (e.kind === "boss") {
      ctx.fillStyle = flash ? "#ffffff" : e.def.color;
      this.drawBoss(ctx, e, flash);
    } else {
      this.drawEnemyBody(ctx, e, flash);
    }
    ctx.restore();

    // HP 바 (미니, 보스는 HUD)
    if (e.kind !== "boss" && e.hp < e.maxHp) {
      const w = r * 2;
      const hx = e.x - r;
      const hy = e.y - r - 12 + bobY;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(hx - 1, hy - 1, w + 2, 5);
      ctx.fillStyle = "#e8544f";
      ctx.fillRect(hx, hy, w, 3);
      ctx.fillStyle = "#7bff8f";
      ctx.fillRect(hx, hy, w * clamp(e.hp / e.maxHp, 0, 1), 3);
    }
  }

  // 톱니바퀴 (에스컬레이터/신호등 기계 파츠)
  private gear(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rad: number,
    col: string,
    out: string,
    spin: number
  ) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.fillStyle = col;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.save();
      ctx.translate(Math.cos(a) * rad, Math.sin(a) * rad);
      ctx.rotate(a);
      ctx.fillRect(-rad * 0.2, -rad * 0.2, rad * 0.4, rad * 0.5);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, TAU);
    ctx.fill();
    ctx.fillStyle = out;
    ctx.beginPath();
    ctx.arc(0, 0, rad * 0.34, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 몬스터별 손그림 스프라이트 (origin = 몸 중심, 이미 scale 적용됨)
  // 몬스터 도감 아트를 참고해 실루엣·표정·기계 디테일을 살렸다.
  private drawEnemyBody(ctx: CanvasRenderingContext2D, e: Enemy, flash: boolean) {
    const r = e.radius;
    const C = (c: string) => (flash ? "#ffffff" : c);
    const OUT = flash ? "#ffffff" : "#17101f";
    const white = C("#ffffff");
    const t = this.tMs;
    const outline = (lw = 2.5) => {
      ctx.strokeStyle = OUT;
      ctx.lineWidth = lw;
      ctx.stroke();
    };

    switch (e.kind) {
      case "gate": {
        // 잔액부족 게이트 — 3D 빨간 카드 단말기 + 성난 얼굴 + 뒤의 군중
        // 뒤 군중(막아선 무리)
        ctx.fillStyle = C("#484d5c");
        for (const sxn of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(sxn * r * 0.95, -r * 0.02, r * 0.3, 0, TAU);
          ctx.fill();
        }
        ctx.strokeStyle = C("#484d5c");
        ctx.lineWidth = r * 0.16;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-r * 0.72, r * 0.15);
        ctx.lineTo(-r * 1.2, -r * 0.05);
        ctx.moveTo(r * 0.72, r * 0.15);
        ctx.lineTo(r * 1.2, -r * 0.05);
        ctx.stroke();
        ctx.lineCap = "butt";
        // 다리
        ctx.fillStyle = OUT;
        ctx.fillRect(-r * 0.4, r * 0.62, r * 0.22, r * 0.42);
        ctx.fillRect(r * 0.18, r * 0.62, r * 0.22, r * 0.42);
        // 큐브: 윗면(아이소메트릭)
        ctx.fillStyle = C("#ff8f84");
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, -r * 0.5);
        ctx.lineTo(-r * 0.5, -r * 0.78);
        ctx.lineTo(r * 0.9, -r * 0.78);
        ctx.lineTo(r * 0.7, -r * 0.5);
        ctx.closePath();
        ctx.fill();
        outline(2);
        // 큐브: 오른쪽 면
        ctx.fillStyle = C("#c23b38");
        ctx.beginPath();
        ctx.moveTo(r * 0.7, -r * 0.5);
        ctx.lineTo(r * 0.9, -r * 0.78);
        ctx.lineTo(r * 0.9, r * 0.45);
        ctx.lineTo(r * 0.7, r * 0.6);
        ctx.closePath();
        ctx.fill();
        outline(2);
        // 큐브: 앞면
        ctx.fillStyle = C("#e8544f");
        this.roundRect(ctx, -r * 0.7, -r * 0.5, r * 1.4, r * 1.15, 4);
        ctx.fill();
        outline();
        // 눈
        ctx.fillStyle = white;
        ctx.beginPath();
        ctx.arc(-r * 0.3, -r * 0.1, r * 0.22, 0, TAU);
        ctx.arc(r * 0.3, -r * 0.1, r * 0.22, 0, TAU);
        ctx.fill();
        ctx.fillStyle = OUT;
        ctx.beginPath();
        ctx.arc(-r * 0.26, -r * 0.04, r * 0.1, 0, TAU);
        ctx.arc(r * 0.34, -r * 0.04, r * 0.1, 0, TAU);
        ctx.fill();
        // 성난 주황 눈썹
        ctx.strokeStyle = C("#ff8a3d");
        ctx.lineWidth = r * 0.15;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.4);
        ctx.lineTo(-r * 0.12, -r * 0.22);
        ctx.moveTo(r * 0.5, -r * 0.4);
        ctx.lineTo(r * 0.12, -r * 0.22);
        ctx.stroke();
        ctx.lineCap = "butt";
        // 카드 슬롯 + 카드
        ctx.fillStyle = OUT;
        this.roundRect(ctx, -r * 0.44, r * 0.24, r * 0.88, r * 0.16, 2);
        ctx.fill();
        ctx.fillStyle = C("#ffcf4a");
        ctx.fillRect(-r * 0.3, r * 0.34, r * 0.6, r * 0.3);
        ctx.fillStyle = C("#c99a2e");
        ctx.fillRect(-r * 0.3, r * 0.42, r * 0.6, r * 0.07);
        break;
      }
      case "crowd": {
        // 밀치는 인파 — 겹친 사람 + 미는 팔
        ctx.fillStyle = C("#5560c8");
        ctx.beginPath();
        ctx.arc(-r * 0.55, -r * 0.05, r * 0.5, 0, TAU);
        ctx.arc(r * 0.55, -r * 0.05, r * 0.5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = OUT;
        ctx.lineWidth = r * 0.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-r * 0.35, r * 0.15);
        ctx.lineTo(-r * 0.95, -r * 0.1);
        ctx.moveTo(r * 0.35, r * 0.15);
        ctx.lineTo(r * 0.95, -r * 0.1);
        ctx.stroke();
        ctx.lineCap = "butt";
        ctx.fillStyle = C("#7c86ff");
        this.roundRect(ctx, -r * 0.6, -r * 0.15, r * 1.2, r * 1.0, r * 0.5);
        ctx.fill();
        outline();
        ctx.beginPath();
        ctx.arc(0, -r * 0.5, r * 0.5, 0, TAU);
        ctx.fillStyle = C("#7c86ff");
        ctx.fill();
        outline();
        this.angryEyes(ctx, -r * 0.52, r * 0.19, r * 0.14, OUT, white);
        break;
      }
      case "lost": {
        // 길잃은 환승객 — 초록 후드 + 백팩 + 헤매는 눈 + ?
        // 백팩
        ctx.fillStyle = C("#2f7d5a");
        this.roundRect(ctx, -r * 0.5, -r * 0.1, r * 1.0, r * 0.95, r * 0.28);
        ctx.fill();
        outline(2);
        // 몸(후드)
        ctx.fillStyle = C("#3fbf8f");
        this.roundRect(ctx, -r * 0.55, 0, r * 1.1, r * 0.82, r * 0.4);
        ctx.fill();
        outline();
        // 백팩 끈
        ctx.strokeStyle = C("#2f7d5a");
        ctx.lineWidth = r * 0.1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.24, 0);
        ctx.lineTo(-r * 0.2, r * 0.55);
        ctx.moveTo(r * 0.24, 0);
        ctx.lineTo(r * 0.2, r * 0.55);
        ctx.stroke();
        // 머리
        ctx.fillStyle = C("#ffcf9e");
        ctx.beginPath();
        ctx.arc(0, -r * 0.45, r * 0.5, 0, TAU);
        ctx.fill();
        outline();
        // 머리카락
        ctx.fillStyle = C("#5a3a1e");
        ctx.beginPath();
        ctx.arc(0, -r * 0.58, r * 0.5, Math.PI, TAU);
        ctx.fill();
        // 헤매는 눈 (크기 다르게)
        ctx.fillStyle = white;
        ctx.beginPath();
        ctx.arc(-r * 0.2, -r * 0.42, r * 0.17, 0, TAU);
        ctx.arc(r * 0.22, -r * 0.42, r * 0.12, 0, TAU);
        ctx.fill();
        ctx.fillStyle = OUT;
        ctx.beginPath();
        ctx.arc(-r * 0.24, -r * 0.46, r * 0.08, 0, TAU);
        ctx.arc(r * 0.24, -r * 0.4, r * 0.05, 0, TAU);
        ctx.fill();
        // ? 말풍선
        ctx.fillStyle = white;
        this.roundRect(ctx, r * 0.35, -r * 1.5, r * 0.75, r * 0.62, 3);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(r * 0.5, -r * 0.9);
        ctx.lineTo(r * 0.62, -r * 0.72);
        ctx.lineTo(r * 0.72, -r * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = OUT;
        ctx.font = `bold ${Math.round(r * 0.5)}px 'Courier New', monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", r * 0.72, -r * 1.19);
        break;
      }
      case "escalator": {
        // 역주행 에스컬레이터 — 기어 + 계단 + 흐르는 빨강 화살표 + 위의 눈
        // 기어(양옆 하단)
        this.gear(ctx, -r * 0.6, r * 0.55, r * 0.28, C("#6b7385"), OUT, t / 500);
        this.gear(ctx, r * 0.6, r * 0.55, r * 0.28, C("#6b7385"), OUT, -t / 500);
        // 본체
        ctx.fillStyle = C("#8a92a4");
        this.roundRect(ctx, -r * 0.72, -r * 0.5, r * 1.44, r * 1.25, 3);
        ctx.fill();
        outline();
        // 상단 레일(밝게)
        ctx.fillStyle = C("#b4bcca");
        this.roundRect(ctx, -r * 0.72, -r * 0.5, r * 1.44, r * 0.26, 3);
        ctx.fill();
        // 계단 라인
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const y = -r * 0.2 + i * r * 0.28;
          ctx.beginPath();
          ctx.moveTo(-r * 0.72, y);
          ctx.lineTo(r * 0.72, y);
          ctx.stroke();
        }
        // 흐르는 빨강 화살표(위로 = 역주행)
        const flow = ((t / 240) % 1) * r * 0.36;
        ctx.fillStyle = C("#ff4b4b");
        for (const oy of [r * 0.5, r * 0.14, -r * 0.22]) {
          const y = oy - flow;
          ctx.beginPath();
          ctx.moveTo(0, y - r * 0.16);
          ctx.lineTo(r * 0.22, y + r * 0.1);
          ctx.lineTo(-r * 0.22, y + r * 0.1);
          ctx.closePath();
          ctx.fill();
        }
        // 위의 눈(줄기 달린)
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.28, -r * 0.5);
        ctx.lineTo(-r * 0.28, -r * 0.8);
        ctx.moveTo(r * 0.28, -r * 0.5);
        ctx.lineTo(r * 0.28, -r * 0.8);
        ctx.stroke();
        ctx.fillStyle = white;
        ctx.beginPath();
        ctx.arc(-r * 0.28, -r * 0.92, r * 0.2, 0, TAU);
        ctx.arc(r * 0.28, -r * 0.92, r * 0.2, 0, TAU);
        ctx.fill();
        outline(2);
        ctx.fillStyle = OUT;
        ctx.beginPath();
        ctx.arc(-r * 0.24, -r * 0.88, r * 0.09, 0, TAU);
        ctx.arc(r * 0.32, -r * 0.88, r * 0.09, 0, TAU);
        ctx.fill();
        break;
      }
      case "kickboard": {
        // 무단질주 킥보드 — 제대로 된 스쿠터 + 성난 얼굴 + 먼지/속도선
        const tel = e.st === "telegraph" && Math.floor(t / 80) % 2 === 0;
        const dashing = e.st === "dash";
        // 먼지(질주 시)
        if (dashing) {
          ctx.fillStyle = C("#c9c2b4");
          for (let i = 0; i < 3; i++) {
            ctx.globalAlpha = 0.5 - i * 0.13;
            ctx.beginPath();
            ctx.arc(-r * (0.9 + i * 0.4), r * 0.5, r * (0.24 - i * 0.05), 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        // 바퀴
        ctx.fillStyle = OUT;
        ctx.beginPath();
        ctx.arc(-r * 0.7, r * 0.6, r * 0.32, 0, TAU);
        ctx.arc(r * 0.7, r * 0.6, r * 0.32, 0, TAU);
        ctx.fill();
        ctx.fillStyle = C("#7a8090");
        ctx.beginPath();
        ctx.arc(-r * 0.7, r * 0.6, r * 0.12, 0, TAU);
        ctx.arc(r * 0.7, r * 0.6, r * 0.12, 0, TAU);
        ctx.fill();
        // 데크
        ctx.fillStyle = C("#ff8a3d");
        this.roundRect(ctx, -r * 0.82, r * 0.28, r * 1.64, r * 0.28, 3);
        ctx.fill();
        outline(2);
        // 스템 + 핸들바 T
        ctx.strokeStyle = C("#3a3f4a");
        ctx.lineWidth = r * 0.16;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(r * 0.7, r * 0.42);
        ctx.lineTo(r * 0.62, -r * 0.75);
        ctx.moveTo(r * 0.28, -r * 0.75);
        ctx.lineTo(r * 0.98, -r * 0.75);
        ctx.stroke();
        ctx.lineCap = "butt";
        // 성난 얼굴(데크 위)
        this.angryEyes(ctx, -r * 0.02, r * 0.3, r * 0.15, OUT, white);
        // 속도선
        if (dashing) {
          ctx.strokeStyle = C("#ffffff");
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 2;
          for (const ly of [-r * 0.1, r * 0.15, r * 0.4]) {
            ctx.beginPath();
            ctx.moveTo(-r * 1.3, ly);
            ctx.lineTo(-r * 0.85, ly);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        if (tel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3;
          this.roundRect(ctx, -r * 1.05, -r * 0.95, r * 2.1, r * 1.75, 6);
          ctx.stroke();
        }
        break;
      }
      case "signal": {
        // 변덕쟁이 신호등 — 3등 하우징 + 기어 받침 + 색 눈썹
        const red = e.st === "red";
        // 받침 기어
        this.gear(ctx, -r * 0.32, r * 0.82, r * 0.24, C("#5a6070"), OUT, t / 600);
        this.gear(ctx, r * 0.32, r * 0.82, r * 0.24, C("#5a6070"), OUT, -t / 600);
        ctx.fillStyle = C("#3a3f4a");
        ctx.fillRect(-r * 0.1, r * 0.55, r * 0.2, r * 0.4);
        // 하우징
        ctx.fillStyle = C("#20242e");
        this.roundRect(ctx, -r * 0.5, -r * 1.05, r * 1.0, r * 1.7, 6);
        ctx.fill();
        outline();
        // 램프 3개 (빨강/노랑/초록)
        const lamp = (ly: number, on: boolean, onColor: string, offColor: string, glow: string) => {
          ctx.save();
          if (on) {
            ctx.shadowColor = glow;
            ctx.shadowBlur = 14;
          }
          ctx.fillStyle = on ? C(onColor) : C(offColor);
          ctx.beginPath();
          ctx.arc(0, ly, r * 0.26, 0, TAU);
          ctx.fill();
          ctx.restore();
        };
        lamp(-r * 0.62, red, "#ff4b4b", "#4a1818", "#ff3a3a");
        lamp(-r * 0.05, false, "#ffd23a", "#4a4020", "#ffd23a");
        lamp(r * 0.52, !red, "#4bff8f", "#153a24", "#4bff8f");
        // 켜진 램프 위 색 눈썹
        const ly = red ? -r * 0.62 : r * 0.52;
        ctx.strokeStyle = red ? C("#ff5a3a") : C("#4bff8f");
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, ly - r * 0.4);
        ctx.lineTo(-r * 0.04, ly - r * 0.26);
        ctx.moveTo(r * 0.3, ly - r * 0.4);
        ctx.lineTo(r * 0.04, ly - r * 0.26);
        ctx.stroke();
        ctx.lineCap = "butt";
        break;
      }
      case "notification": {
        // 푸시 알림 — 빨간 종 + 좌우 링 모션선
        const sway = Math.sin(t / 100 + e.bob) * 0.18;
        // 링 모션선 (흔들리는 반대쪽에 잔상)
        ctx.strokeStyle = C("#ffd23a");
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(s * r * 1.05, 0, r * 0.5, -0.7, 0.7);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(s * r * 1.35, 0, r * 0.55, -0.6, 0.6);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.rotate(sway);
        ctx.fillStyle = C("#ff4b5c");
        ctx.beginPath();
        ctx.moveTo(-r * 0.72, r * 0.5);
        ctx.quadraticCurveTo(-r * 0.72, -r * 0.55, 0, -r * 0.72);
        ctx.quadraticCurveTo(r * 0.72, -r * 0.55, r * 0.72, r * 0.5);
        ctx.closePath();
        ctx.fill();
        outline();
        ctx.fillStyle = C("#d63b4b");
        this.roundRect(ctx, -r * 0.82, r * 0.42, r * 1.64, r * 0.26, 3);
        ctx.fill();
        outline(2);
        ctx.fillStyle = C("#ffcf4a");
        ctx.beginPath();
        ctx.arc(0, -r * 0.78, r * 0.15, 0, TAU);
        ctx.fill();
        ctx.fillStyle = C("#d63b4b");
        ctx.beginPath();
        ctx.arc(0, r * 0.72, r * 0.14, 0, TAU);
        ctx.fill();
        ctx.fillStyle = white;
        ctx.font = `bold ${Math.round(r * 0.95)}px 'Courier New', monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", 0, -r * 0.12);
        break;
      }
      case "queue": {
        // 끝없는 커피 대기줄 — 여러 컵 + 성난 중앙 컵 + 김 + 뒤의 대기줄
        // 뒤 대기줄(회색 머리)
        ctx.fillStyle = C("#484d5c");
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(-r * 0.95 - i * r * 0.32, r * 0.1, r * 0.2, 0, TAU);
          ctx.fill();
        }
        // 김
        ctx.strokeStyle = C("#ffffff");
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        for (const sx of [-r * 0.25, r * 0.05, r * 0.35]) {
          ctx.beginPath();
          ctx.moveTo(sx, -r * 0.7);
          ctx.quadraticCurveTo(sx + r * 0.16, -r * 0.95, sx, -r * 1.2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // 곁 컵(양옆, 조금 작게)
        const sideCup = (cx: number, body: string) => {
          ctx.fillStyle = C(body);
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.32, -r * 0.35);
          ctx.lineTo(cx + r * 0.32, -r * 0.35);
          ctx.lineTo(cx + r * 0.26, r * 0.7);
          ctx.lineTo(cx - r * 0.26, r * 0.7);
          ctx.closePath();
          ctx.fill();
          outline(2);
          ctx.fillStyle = C("#4a3018");
          this.roundRect(ctx, cx - r * 0.38, -r * 0.5, r * 0.76, r * 0.2, 2);
          ctx.fill();
        };
        sideCup(-r * 0.5, "#c98a52");
        sideCup(r * 0.55, "#e0e0e6");
        // 중앙 큰 컵
        ctx.fillStyle = C("#ece0cf");
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.55);
        ctx.lineTo(r * 0.5, -r * 0.55);
        ctx.lineTo(r * 0.42, r * 0.85);
        ctx.lineTo(-r * 0.42, r * 0.85);
        ctx.closePath();
        ctx.fill();
        outline();
        // 뚜껑
        ctx.fillStyle = C("#5a3a22");
        this.roundRect(ctx, -r * 0.6, -r * 0.72, r * 1.2, r * 0.24, 3);
        ctx.fill();
        outline(2);
        ctx.fillStyle = OUT;
        this.roundRect(ctx, -r * 0.14, -r * 0.7, r * 0.28, r * 0.11, 2);
        ctx.fill();
        // 슬리브
        ctx.fillStyle = C("#8a5a2b");
        ctx.beginPath();
        ctx.moveTo(-r * 0.48, -r * 0.1);
        ctx.lineTo(r * 0.48, -r * 0.1);
        ctx.lineTo(r * 0.44, r * 0.3);
        ctx.lineTo(-r * 0.44, r * 0.3);
        ctx.closePath();
        ctx.fill();
        outline(2);
        this.angryEyes(ctx, r * 0.05, r * 0.24, r * 0.15, OUT, white);
        break;
      }
      case "badge": {
        // 출입증 인식오류 — 랜야드 + 카드(사진/ERR/바코드) + 리더기
        // 랜야드 끈
        ctx.strokeStyle = C("#2a6cff");
        ctx.lineWidth = r * 0.1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.32, -r * 0.6);
        ctx.lineTo(-r * 0.06, -r * 1.35);
        ctx.lineTo(r * 0.06, -r * 1.35);
        ctx.lineTo(r * 0.32, -r * 0.6);
        ctx.stroke();
        // 클립
        ctx.fillStyle = C("#8a90a0");
        ctx.fillRect(-r * 0.08, -r * 0.72, r * 0.16, r * 0.18);
        // 카드
        ctx.fillStyle = C("#2a5cff");
        this.roundRect(ctx, -r * 0.65, -r * 0.6, r * 1.3, r * 1.2, 5);
        ctx.fill();
        outline();
        // 헤더바
        ctx.fillStyle = C("#1a3a9e");
        this.roundRect(ctx, -r * 0.65, -r * 0.6, r * 1.3, r * 0.26, 5);
        ctx.fill();
        // 사진(작은 얼굴)
        ctx.fillStyle = C("#cfe0ff");
        this.roundRect(ctx, -r * 0.5, -r * 0.24, r * 0.5, r * 0.56, 2);
        ctx.fill();
        ctx.fillStyle = C("#7bd0a0");
        ctx.beginPath();
        ctx.arc(-r * 0.25, r * 0.06, r * 0.16, 0, TAU);
        ctx.fill();
        ctx.fillStyle = OUT;
        ctx.fillRect(-r * 0.31, r * 0.0, r * 0.05, r * 0.05);
        ctx.fillRect(-r * 0.19, r * 0.0, r * 0.05, r * 0.05);
        // ERR!
        const errBlink = Math.floor(t / 400) % 2 === 0;
        ctx.fillStyle = errBlink ? C("#ff5d5d") : C("#7a2a2a");
        ctx.font = `bold ${Math.round(r * 0.3)}px 'Courier New', monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("ERR!", r * 0.28, -r * 0.05);
        // 바코드
        ctx.fillStyle = C("#0e1a3a");
        for (let i = 0; i < 7; i++) {
          const bw = i % 2 ? r * 0.04 : r * 0.07;
          ctx.fillRect(r * 0.05 + i * r * 0.08, r * 0.22, bw, r * 0.22);
        }
        // 리더기(카드가 꽂힌 받침)
        ctx.fillStyle = C("#2a2f3a");
        this.roundRect(ctx, -r * 0.42, r * 0.66, r * 0.84, r * 0.5, 3);
        ctx.fill();
        outline(2);
        ctx.fillStyle = OUT;
        ctx.fillRect(-r * 0.26, r * 0.74, r * 0.52, r * 0.08);
        break;
      }
    }
  }

  private drawBoss(ctx: CanvasRenderingContext2D, e: Enemy, flash: boolean) {
    const r = e.radius;
    const inv = this.tMs < this.bossInvulnUntil;
    // 오라
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.sin(this.tMs / 200) * 0.1;
    ctx.fillStyle = "#ff3a3a";
    ctx.beginPath();
    ctx.arc(0, 0, r + 12 + Math.sin(this.tMs / 160) * 4, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 몸통(어두운 정장 괴물)
    ctx.fillStyle = flash || inv ? "#ffffff" : "#1a1030";
    this.roundRect(ctx, -r * 0.8, -r * 0.7, r * 1.6, r * 1.7, 10);
    ctx.fill();
    ctx.strokeStyle = "#ff3a3a";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 머리(달력 MON)
    ctx.fillStyle = flash ? "#ffffff" : "#f4f4ff";
    this.roundRect(ctx, -r * 0.5, -r * 1.15, r, r * 0.72, 6);
    ctx.fill();
    ctx.fillStyle = "#ff3a3a";
    ctx.fillRect(-r * 0.5, -r * 1.15, r, r * 0.2);
    ctx.fillStyle = "#1a1030";
    ctx.font = `bold ${Math.round(r * 0.42)}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("MON", 0, -r * 0.62);

    // 눈
    ctx.fillStyle = "#ff3a3a";
    const blink = Math.sin(this.tMs / 300) > -0.9;
    if (blink) {
      ctx.beginPath();
      ctx.arc(-r * 0.32, -r * 0.1, r * 0.14, 0, TAU);
      ctx.arc(r * 0.32, -r * 0.1, r * 0.14, 0, TAU);
      ctx.fill();
    }
    // 페이즈 표시(넥타이 개수)
    ctx.fillStyle = "#ff3a3a";
    for (let i = 0; i < this.bossPhase; i++) {
      ctx.fillRect(-6 + i * 6 - (this.bossPhase - 1) * 3, r * 0.2, 4, r * 0.6);
    }
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, pr: Projectile) {
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(pr.spin);
    ctx.shadowColor = pr.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = pr.color;
    if (pr.fromBoss) {
      // 마름모(마감/알림)
      ctx.beginPath();
      ctx.moveTo(0, -pr.radius);
      ctx.lineTo(pr.radius, 0);
      ctx.lineTo(0, pr.radius);
      ctx.lineTo(-pr.radius, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, pr.radius * 0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawPickup(ctx: CanvasRenderingContext2D, pk: Pickup) {
    const bob = Math.sin(pk.bob) * 4;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    // 반짝임 링
    ctx.globalAlpha = 0.5 + Math.sin(pk.bob * 2) * 0.2;
    ctx.strokeStyle = pk.kind === "coffee" ? "#8fffcf" : "#ffcf4a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = "18px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pk.kind === "coffee" ? "☕" : "🥤", 0, 0);
    // 소멸 임박 깜빡임
    ctx.restore();
  }

  private drawSlash(ctx: CanvasRenderingContext2D, s: SlashFx) {
    const t = s.life / s.maxLife;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 14;
    if (s.arc >= TAU - 0.01) {
      // 스킬 원형 충격파
      const rr = lerp(s.reach * 0.3, s.reach, 1 - t);
      ctx.globalAlpha = clamp(t, 0, 1) * 0.85;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 6 * t + 2;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, TAU);
      ctx.stroke();
    } else {
      // 초승달 모양 검기 (안쪽을 파내어 곡선 궤적으로)
      ctx.rotate(s.angle);
      const inner = s.reach * (0.4 + (1 - t) * 0.25);
      ctx.globalAlpha = clamp(t, 0, 1) * 0.85;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(0, 0, s.reach, -s.arc / 2, s.arc / 2);
      ctx.arc(0, 0, inner, s.arc / 2, -s.arc / 2, true);
      ctx.closePath();
      ctx.fill();
      // 밝은 앞날
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.fillStyle = "#f5ffff";
      ctx.beginPath();
      ctx.arc(0, 0, s.reach, -s.arc / 2, s.arc / 2);
      ctx.arc(0, 0, s.reach - 3, s.arc / 2, -s.arc / 2, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawParticle(ctx: CanvasRenderingContext2D, pt: Particle) {
    const t = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.globalAlpha = t;
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    ctx.globalAlpha = 1;
  }

  private drawDamageNumber(ctx: CanvasRenderingContext2D, d: DamageNumber) {
    const t = clamp(d.life / d.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.font = `bold ${Math.round(15 * d.scale)}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.strokeText(d.text, d.x, d.y);
    ctx.fillStyle = d.color;
    ctx.fillText(d.text, d.x, d.y);
    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D) {
    const g = ctx.createRadialGradient(
      VIEW_W / 2,
      VIEW_H / 2,
      VIEW_H * 0.35,
      VIEW_W / 2,
      VIEW_H / 2,
      VIEW_H * 0.8
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // 유틸: 둥근 사각형
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
