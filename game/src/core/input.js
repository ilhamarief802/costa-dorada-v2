// Keyboard and mouse, gathered once and read as intent. Mouse look only accumulates while the
// pointer is locked to the canvas; capture shots never lock it.

const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  enter: ['KeyE'],
  handbrake: ['Space'],
  pause: ['Escape'],
  confirm: ['Enter', 'NumpadEnter'],
  restart: ['KeyR'],
  horn: ['KeyH'],
};

export default class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.edges = new Set();
    this.mouse = { x: 0, y: 0 };
    this.enabled = true;
    this.locked = false;
    this.dragging = false;
    this.onLockChange = null;

    this.handleKeyDown = (event) => {
      if (event.repeat) {
        if (this.isGameKey(event.code)) event.preventDefault();
        return;
      }
      if (this.isGameKey(event.code)) event.preventDefault();
      if (!this.down.has(event.code)) this.edges.add(event.code);
      this.down.add(event.code);
    };
    this.handleKeyUp = (event) => {
      this.down.delete(event.code);
    };
    this.handleBlur = () => {
      this.down.clear();
      this.edges.clear();
    };
    this.handleMouseMove = (event) => {
      if (!this.enabled) return;
      if (!this.locked && !this.dragging) return;
      this.mouse.x += event.movementX || 0;
      this.mouse.y += event.movementY || 0;
    };
    this.handleMouseDown = () => {
      this.dragging = true;
    };
    this.handleMouseUp = () => {
      this.dragging = false;
    };
    this.handlePointerLock = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this.handleClick = () => {
      if (this.enabled && !this.locked && this.canvas.requestPointerLock) {
        const result = this.canvas.requestPointerLock();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    };

    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleClick);
    window.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('pointerlockchange', this.handlePointerLock);
  }

  isGameKey(code) {
    for (const list of Object.values(BINDINGS)) if (list.includes(code)) return true;
    return false;
  }

  isDown(action) {
    if (!this.enabled) return false;
    const codes = BINDINGS[action];
    if (!codes) return false;
    for (const code of codes) if (this.down.has(code)) return true;
    return false;
  }

  /** True once per physical key press. */
  pressed(action) {
    if (!this.enabled) return false;
    const codes = BINDINGS[action];
    if (!codes) return false;
    for (const code of codes) if (this.edges.has(code)) return true;
    return false;
  }

  /** Mouse movement since the last call, in pixels. */
  consumeLook() {
    const look = { x: this.mouse.x, y: this.mouse.y };
    this.mouse.x = 0;
    this.mouse.y = 0;
    return look;
  }

  endFrame() {
    this.edges.clear();
  }

  release() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  dispose() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleClick);
    window.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('pointerlockchange', this.handlePointerLock);
  }
}
