// Title, pause and controls screens. Plain DOM over the live scene, so the city keeps rendering
// behind the title card and the transition into play is a fade, not a load. The title offers
// Continue (only when a save exists), New Game and Controls.

export default class Menus {
  constructor(seed) {
    this.seed = seed;
    this.onStart = null;
    this.onContinue = null;
    this.onNewGame = null;
    this.onResume = null;
    this.onRestart = null;
    this.onSave = null;

    this.title = document.createElement('div');
    this.title.id = 'title';
    this.title.innerHTML = `
      <div class="title-inner">
        <div class="kicker">A Sunset Crime Saga · Costa Dorada</div>
        <h1>COSTA<br>DORADA</h1>
        <div class="title-rule"></div>
        <p class="tagline">The sun goes down. The city stays up.</p>
        <div class="title-menu">
          <button class="title-item" data-action="continue" disabled>CONTINUE<span class="hint">Saved run</span></button>
          <button class="title-item" data-action="new">NEW GAME<span class="hint">Enter</span></button>
          <button class="title-item" data-action="controls">CONTROLS<span class="hint">?</span></button>
        </div>
        <div class="seed-line">SEED ${seed} · CITY OF PALMS AND PETROL</div>
      </div>
      <div class="controls-panel hidden">
        <div class="kicker">Controls</div>
        <div class="pause-item"><span>MOVE</span><b>W A S D</b></div>
        <div class="pause-item"><span>SPRINT / JUMP</span><b>SHIFT / SPACE</b></div>
        <div class="pause-item"><span>DRIVE · HAND BRAKE</span><b>W S A D · SPACE</b></div>
        <div class="pause-item"><span>STEAL A CAR</span><b>F</b></div>
        <div class="pause-item"><span>FIRE · RELOAD</span><b>LMB · R</b></div>
        <div class="pause-item"><span>SWAP WEAPON</span><b>1 · 2</b></div>
        <div class="pause-item"><span>ACTIVITY</span><b>F at a marker</b></div>
        <div class="pause-item"><span>SAVE / PAUSE</span><b>ESC</b></div>
      </div>
      <div class="controls-line">WASD MOVE · SHIFT SPRINT · C CROUCH · SPACE JUMP · E DRIVE · F STEAL · ESC PAUSE</div>
    `;
    document.body.appendChild(this.title);

    this.pause = document.createElement('div');
    this.pause.id = 'pause';
    this.pause.classList.add('hidden');
    this.pause.innerHTML = `
      <div class="pause-panel">
        <div class="kicker">Costa Dorada</div>
        <h2>PAUSED</h2>
        <div class="pause-item"><span>RESUME</span><b>ENTER</b></div>
        <div class="pause-item"><span>RESTART RUN</span><b>R</b></div>
        <div class="pause-item"><span>SAVE GAME</span><b>F5</b></div>
        <div class="pause-item"><span>SEED</span><b>${seed}</b></div>
      </div>
    `;
    document.body.appendChild(this.pause);

    this.controlsPanel = this.title.querySelector('.controls-panel');
    this.continueButton = this.title.querySelector('[data-action="continue"]');

    this.title.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = button.dataset.action;
        if (action === 'continue') {
          if (this.onContinue) this.onContinue();
        } else if (action === 'new') {
          if (this.onNewGame) this.onNewGame();
          else if (this.onStart) this.onStart();
        } else if (action === 'controls') {
          this.controlsPanel.classList.toggle('hidden');
        }
      });
    });
    this.title.addEventListener('click', () => {
      if (!this.controlsPanel.classList.contains('hidden')) return;
      if (this.onNewGame) this.onNewGame();
      else if (this.onStart) this.onStart();
    });
    this.pause.addEventListener('click', () => {
      if (this.onResume) this.onResume();
    });
  }

  setHasSave(hasSave) {
    this.continueButton.disabled = !hasSave;
    this.continueButton.classList.toggle('dim', !hasSave);
    if (!hasSave) this.controlsPanel.classList.add('hidden');
  }

  hideTitle() {
    this.title.classList.add('hidden');
  }

  showTitle() {
    this.title.classList.remove('hidden');
  }

  showPause() {
    this.pause.classList.remove('hidden');
  }

  hidePause() {
    this.pause.classList.add('hidden');
  }

  isTitleVisible() {
    return !this.title.classList.contains('hidden');
  }
}
