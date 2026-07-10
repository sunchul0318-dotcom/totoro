// ============================================================
// 판교 퀘스트 — WebAudio 기반 레트로 사운드 신디사이저
// 외부 에셋 없이 8bit 느낌의 효과음/BGM을 코드로 생성한다.
// ============================================================

type SfxName =
  | "attack"
  | "hit"
  | "enemyHit"
  | "dodge"
  | "skill"
  | "levelup"
  | "pickup"
  | "hurt"
  | "enemyDie"
  | "select"
  | "confirm"
  | "stageClear"
  | "bossWarn"
  | "gameover";

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private bgmGain: GainNode | null = null;
  private currentBgm: "field" | "boss" | null = null;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // 사용자 제스처 후 호출해서 오디오 컨텍스트 재개
  resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  private beep(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, slideTo),
        t0 + dur
      );
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = vol;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 800;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  play(name: SfxName) {
    if (this.muted) return;
    switch (name) {
      case "attack":
        this.beep(420, 0.09, "square", 0.18, 620);
        break;
      case "enemyHit":
        this.beep(220, 0.06, "square", 0.14, 130);
        this.noise(0.05, 0.06);
        break;
      case "hit":
        this.noise(0.08, 0.12);
        this.beep(180, 0.1, "square", 0.16, 90);
        break;
      case "dodge":
        this.beep(700, 0.14, "sine", 0.13, 300);
        break;
      case "skill":
        this.beep(160, 0.05, "sawtooth", 0.2, 500);
        this.beep(320, 0.35, "square", 0.18, 90, 0.03);
        this.noise(0.3, 0.12, 0.02);
        break;
      case "levelup":
        this.beep(523, 0.1, "square", 0.18);
        this.beep(659, 0.1, "square", 0.18, undefined, 0.1);
        this.beep(784, 0.1, "square", 0.18, undefined, 0.2);
        this.beep(1046, 0.24, "square", 0.2, undefined, 0.3);
        break;
      case "pickup":
        this.beep(880, 0.08, "square", 0.16);
        this.beep(1200, 0.1, "square", 0.16, undefined, 0.07);
        break;
      case "hurt":
        this.beep(300, 0.18, "sawtooth", 0.2, 80);
        this.noise(0.12, 0.14);
        break;
      case "enemyDie":
        this.beep(300, 0.2, "square", 0.14, 60);
        this.noise(0.16, 0.1);
        break;
      case "select":
        this.beep(600, 0.05, "square", 0.12);
        break;
      case "confirm":
        this.beep(660, 0.07, "square", 0.16);
        this.beep(990, 0.1, "square", 0.16, undefined, 0.06);
        break;
      case "stageClear":
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) =>
          this.beep(f, 0.16, "square", 0.18, undefined, i * 0.13)
        );
        break;
      case "bossWarn":
        this.beep(110, 0.5, "sawtooth", 0.2, 90);
        this.beep(120, 0.5, "square", 0.14, 80, 0.25);
        break;
      case "gameover":
        [440, 392, 349, 262].forEach((f, i) =>
          this.beep(f, 0.35, "square", 0.18, undefined, i * 0.28)
        );
        break;
    }
  }

  // 간단한 아르페지오 루프 BGM
  startBgm(kind: "field" | "boss") {
    const ctx = this.ensure();
    if (!ctx) return;
    if (this.currentBgm === kind && this.bgmTimer !== null) return;
    this.stopBgm();
    this.currentBgm = kind;
    this.bgmStep = 0;

    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = 0.055;
    if (this.master) this.bgmGain.connect(this.master);

    // 판교 출근 행진곡 / 보스 테마 (간단한 시퀀스)
    const field = [
      262, 330, 392, 330, 294, 349, 440, 349, 262, 330, 392, 523, 494, 392, 330,
      294,
    ];
    const boss = [
      196, 233, 196, 294, 233, 196, 175, 220, 147, 175, 220, 262, 233, 196, 175,
      147,
    ];
    const seq = kind === "boss" ? boss : field;
    const interval = kind === "boss" ? 200 : 240;

    const tick = () => {
      if (this.muted || !this.ctx || !this.bgmGain) return;
      const note = seq[this.bgmStep % seq.length];
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = kind === "boss" ? "sawtooth" : "square";
      osc.frequency.value = note;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + interval / 1000);
      osc.connect(g);
      g.connect(this.bgmGain);
      osc.start(t0);
      osc.stop(t0 + interval / 1000 + 0.02);

      // 베이스 라인 (2박마다)
      if (this.bgmStep % 2 === 0) {
        const bass = this.ctx.createOscillator();
        const bg = this.ctx.createGain();
        bass.type = "triangle";
        bass.frequency.value = note / 2;
        bg.gain.setValueAtTime(0.0001, t0);
        bg.gain.exponentialRampToValueAtTime(0.7, t0 + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.0001, t0 + (interval * 1.6) / 1000);
        bass.connect(bg);
        bg.connect(this.bgmGain);
        bass.start(t0);
        bass.stop(t0 + (interval * 1.6) / 1000 + 0.02);
      }
      this.bgmStep++;
    };
    tick();
    this.bgmTimer = window.setInterval(tick, interval);
  }

  stopBgm() {
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    this.currentBgm = null;
  }
}

export const audio = new AudioManager();
