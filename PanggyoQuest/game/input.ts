// ============================================================
// 판교 퀘스트 — 입력 관리 (키보드 + 터치)
// ============================================================

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  // "눌린 순간" 플래그 (프레임 소비형)
  attackPressed: boolean;
  dodgePressed: boolean;
  skillPressed: boolean;
  pausePressed: boolean;
  // 터치 조이스틱 벡터 (-1~1)
  moveX: number;
  moveY: number;
}

export class InputManager {
  state: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
    attackPressed: false,
    dodgePressed: false,
    skillPressed: false,
    pausePressed: false,
    moveX: 0,
    moveY: 0,
  };

  private keydown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    switch (k) {
      case "w":
      case "arrowup":
        this.state.up = true;
        break;
      case "s":
      case "arrowdown":
        this.state.down = true;
        break;
      case "a":
      case "arrowleft":
        this.state.left = true;
        break;
      case "d":
      case "arrowright":
        this.state.right = true;
        break;
      case "j":
      case "z":
      case " ":
        if (!e.repeat) this.state.attackPressed = true;
        break;
      case "k":
      case "x":
      case "shift":
        if (!e.repeat) this.state.dodgePressed = true;
        break;
      case "l":
      case "c":
        if (!e.repeat) this.state.skillPressed = true;
        break;
      case "escape":
      case "p":
        if (!e.repeat) this.state.pausePressed = true;
        break;
    }
    // 게임 조작키의 기본 스크롤 동작 방지
    if (
      [
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        " ",
      ].includes(k)
    ) {
      e.preventDefault();
    }
  };

  private keyup = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    switch (k) {
      case "w":
      case "arrowup":
        this.state.up = false;
        break;
      case "s":
      case "arrowdown":
        this.state.down = false;
        break;
      case "a":
      case "arrowleft":
        this.state.left = false;
        break;
      case "d":
      case "arrowright":
        this.state.right = false;
        break;
    }
  };

  attach() {
    window.addEventListener("keydown", this.keydown, { passive: false });
    window.addEventListener("keyup", this.keyup);
  }

  detach() {
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
  }

  // 터치 UI에서 호출
  setMove(x: number, y: number) {
    this.state.moveX = x;
    this.state.moveY = y;
  }

  pressAttack() {
    this.state.attackPressed = true;
  }
  pressDodge() {
    this.state.dodgePressed = true;
  }
  pressSkill() {
    this.state.skillPressed = true;
  }
  pressPause() {
    this.state.pausePressed = true;
  }

  // 매 프레임 소비 후 순간입력 플래그 리셋
  consume() {
    this.state.attackPressed = false;
    this.state.dodgePressed = false;
    this.state.skillPressed = false;
    this.state.pausePressed = false;
  }

  // 이동 입력을 정규화한 방향 벡터로 (키보드 + 터치 합산)
  getMoveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.state.left) x -= 1;
    if (this.state.right) x += 1;
    if (this.state.up) y -= 1;
    if (this.state.down) y += 1;
    x += this.state.moveX;
    y += this.state.moveY;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }
}
