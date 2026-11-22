// Fixed-timestep simulation with an interpolated render. The world advances in exact 1/60
// slices so seeded runs and recorded shots stay reproducible whatever the display does.

import { STEP, MAX_STEPS } from './config.js';

export default class GameLoop {
  constructor({ update, render, step = STEP, maxSteps = MAX_STEPS }) {
    this.update = update;
    this.render = render;
    this.step = step;
    this.maxSteps = maxSteps;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.frame = this.frame.bind(this);
    this.stats = { frameMs: 0, updateMs: 0, renderMs: 0, fps: 60 };
    this.fpsWindow = 0;
    this.fpsFrames = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.fpsWindow = this.lastTime;
    this.fpsFrames = 0;
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  frame(now) {
    if (!this.running) return;
    const started = now;
    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    delta = Math.min(delta, 0.25);
    this.accumulator += delta;

    const updateStart = performance.now();
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.update(this.step);
      this.accumulator -= this.step;
      steps += 1;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    const updateEnd = performance.now();

    const alpha = this.accumulator / this.step;
    this.render(alpha, delta);
    const end = performance.now();

    this.stats.updateMs = updateEnd - updateStart;
    this.stats.renderMs = end - updateEnd;
    this.stats.frameMs = end - started;
    this.fpsFrames += 1;
    if (end - this.fpsWindow > 500) {
      this.stats.fps = (this.fpsFrames * 1000) / (end - this.fpsWindow);
      this.fpsWindow = end;
      this.fpsFrames = 0;
    }
    requestAnimationFrame(this.frame);
  }
}
