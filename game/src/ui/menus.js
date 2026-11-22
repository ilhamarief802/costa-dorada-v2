// Title and pause screens. Both are plain DOM over the live scene, so the city keeps rendering
// behind the title card and the transition into play is a fade, not a load.

export default class Menus {
  constructor(seed) {
    this.seed = seed;
    this.onStart = null;
    this.onResume = null;
    this.onRestart = null;

    this.title = document.createElement('div');
    this.title.id = 'title';
    this.title.innerHTML = `
      <div class="title-inner">
        <div class="kicker">A Sunset Crime Saga · Costa Dorada</div>
        <h1>COSTA<br>DORADA</h1>
        <div class="title-rule"></div>
        <p class="tagline">The sun goes down. The city stays up.</p>
        <div class="press">PRESS ENTER</div>
        <div class="seed-line">SEED ${seed} · CITY OF PALMS AND PETROL</div>
      </div>
      <div class="controls-line">WASD MOVE · SHIFT SPRINT · C CROUCH · SPACE JUMP · E DRIVE · ESC PAUSE</div>
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
        <div class="pause-item"><span>SEED</span><b>${seed}</b></div>
      </div>
    `;
    document.body.appendChild(this.pause);

    this.title.addEventListener('click', () => {
      if (this.onStart) this.onStart();
    });
    this.pause.addEventListener('click', () => {
      if (this.onResume) this.onResume();
    });
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
