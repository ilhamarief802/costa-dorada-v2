// The heads-up display: mission card driven by the live mission chain, wanted stars, money and
// clock, circular minimap, health and armour, weapon slot, activity ticker and the contextual
// enter / steal / restart prompt.

import { HUD, WANTED } from '../core/config.js';
import { formatMoney, formatClock } from '../core/math.js';
import Minimap from './minimap.js';

export default class Hud {
  constructor(plan) {
    this.plan = plan;
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="mission-card">
        <div class="mission-eyebrow">${HUD.mission.eyebrow}</div>
        <div class="mission-title">${HUD.mission.title}</div>
        <div class="mission-detail">${HUD.mission.detail}</div>
        <div class="mission-meta"><span class="distance">-- M</span><span class="mission-status">PRIMARY</span></div>
      </div>
      <div class="wanted-stars" aria-label="wanted level">
        ${Array.from({ length: 5 }, (_, i) => `<span class="star" data-index="${i}"></span>`).join('')}
      </div>
      <div class="top-right">
        <div class="money">${formatMoney(HUD.money)}</div>
        <div class="clock">17:21</div>
        <div class="minimap-wrap">
          <canvas width="512" height="512"></canvas>
          <div class="minimap-north">N</div>
          <div class="minimap-ring"></div>
        </div>
      </div>
      <div class="bottom-left">
        <div class="status-bars">
          <div class="status-row"><span class="status-label">HEALTH</span><div class="bar health"><span style="width:${HUD.health}%"></span></div></div>
          <div class="status-row"><span class="status-label">ARMOUR</span><div class="bar armour"><span style="width:${HUD.armour}%"></span></div></div>
        </div>
        <div class="weapon-slot">
          <div class="weapon-mark">${HUD.weapon}</div>
          <div class="weapon-ammo">${HUD.ammo}<small> / ${HUD.reserve}</small></div>
        </div>
      </div>
      <div class="activity-ticker"></div>
      <div class="toast"></div>
      <div class="damage-flash"></div>
      <div class="prompt"></div>
    `;
    document.body.appendChild(this.root);

    const vignette = document.createElement('div');
    vignette.id = 'vignette';
    document.body.appendChild(vignette);

    this.distance = this.root.querySelector('.distance');
    this.status = this.root.querySelector('.mission-status');
    this.eyebrow = this.root.querySelector('.mission-eyebrow');
    this.title = this.root.querySelector('.mission-title');
    this.detail = this.root.querySelector('.mission-detail');
    this.card = this.root.querySelector('.mission-card');
    this.clock = this.root.querySelector('.clock');
    this.money = this.root.querySelector('.money');
    this.prompt = this.root.querySelector('.prompt');
    this.ticker = this.root.querySelector('.activity-ticker');
    this.toastElement = this.root.querySelector('.toast');
    this.flash = this.root.querySelector('.damage-flash');
    this.bars = {
      health: this.root.querySelector('.bar.health span'),
      armour: this.root.querySelector('.bar.armour span'),
    };
    this.weaponMark = this.root.querySelector('.weapon-mark');
    this.weaponAmmo = this.root.querySelector('.weapon-ammo');
    this.stars = Array.from(this.root.querySelectorAll('.star'));
    this.minimap = new Minimap(plan, this.root.querySelector('.minimap-wrap canvas'));
    this.lastDistance = '';
    this.lastClock = '';
    this.lastStars = -1;
    this.lastMoney = -1;
    this.lastWeapon = '';
    this.visible = false;
    this.flashTimer = 0;
    this.objective = HUD.objective;
    this.actors = null;
  }

  show(visible) {
    this.visible = visible;
    this.root.classList.toggle('visible', visible);
  }

  setPrompt(text) {
    if (!text) {
      this.prompt.classList.remove('visible');
      this.prompt.innerHTML = '';
      return;
    }
    if (this.prompt.dataset.text !== text) {
      this.prompt.dataset.text = text;
      this.prompt.innerHTML = text;
    }
    this.prompt.classList.add('visible');
  }

  /** Mission card text comes from the mission system; pass null for free roam. */
  setMission(card) {
    if (!card) return;
    if (this.card.dataset.eyebrow !== card.eyebrow) {
      this.card.dataset.eyebrow = card.eyebrow;
      this.eyebrow.textContent = card.eyebrow;
      this.title.textContent = card.title;
      this.detail.textContent = card.detail;
    }
    if (card.status !== undefined && this.status.textContent !== card.status) {
      this.status.textContent = card.status;
      this.status.classList.toggle('alert', String(card.status).includes('FAILED'));
    }
  }

  setWanted(stars) {
    if (stars === this.lastStars) return;
    this.lastStars = stars;
    this.stars.forEach((element, index) => {
      element.classList.toggle('lit', index < stars);
      element.classList.toggle('hot', index < stars && stars >= 4);
    });
    this.root.classList.toggle('wanted', stars > 0);
  }

  setVitals(health, armour) {
    if (health !== undefined) this.bars.health.style.width = `${Math.max(0, Math.min(100, health))}%`;
    if (armour !== undefined) this.bars.armour.style.width = `${Math.max(0, Math.min(100, armour))}%`;
  }

  setWeapon(state) {
    if (!state) return;
    const label = state.reloading ? 'RELOAD' : state.weapon;
    if (label !== this.lastWeapon) {
      this.weaponMark.textContent = label;
      this.lastWeapon = label;
    }
    const text = state.reloading ? '··<small> / ·</small>' : `${state.ammo}<small> / ${state.reserve}</small>`;
    if (this.weaponAmmo.dataset.text !== text) {
      this.weaponAmmo.dataset.text = text;
      this.weaponAmmo.innerHTML = text;
    }
  }

  setMoney(value) {
    if (value === this.lastMoney) return;
    this.lastMoney = value;
    this.money.textContent = formatMoney(value);
  }

  /** A short-lived line above the prompt: rewards, mission beats, "SAVED". */
  toast(html, seconds = 2.6) {
    this.toastTimer = seconds;
    this.toastElement.innerHTML = html;
    this.toastElement.classList.add('visible');
  }

  setActivity(state) {
    if (!state) {
      this.ticker.classList.remove('visible');
      return;
    }
    this.ticker.classList.add('visible');
    const text = `<b>${state.label}</b><span>${state.detail}</span>`;
    if (this.ticker.dataset.text !== text) {
      this.ticker.dataset.text = text;
      this.ticker.innerHTML = text;
    }
  }

  hit(damage = 12) {
    this.flashTimer = 0.28;
    this.root.classList.add('hurt');
    if (damage > 0) this.setVitals(this.currentHealth, this.currentArmour);
  }

  update(dt, state) {
    const clock = formatClock(state.hour);
    if (clock !== this.lastClock) {
      this.clock.textContent = clock;
      this.lastClock = clock;
    }
    const objective = state.objective ?? this.objective;
    const dx = state.position.x - objective.x;
    const dz = state.position.z - objective.z;
    const meters = `${Math.max(0, Math.round(Math.hypot(dx, dz)))} M`;
    if (meters !== this.lastDistance) {
      this.distance.textContent = meters;
      this.lastDistance = meters;
    }
    if (state.actors) {
      this.actors = state.actors;
      this.minimap.update(dt, state.position, state.heading, state.cameraYaw, objective, state.actors);
    } else {
      this.minimap.update(dt, state.position, state.heading, state.cameraYaw, objective);
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.root.classList.remove('hurt');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastElement.classList.remove('visible');
    }
    this.setWanted(state.stars ?? 0);
    if (state.money !== undefined) this.setMoney(state.money);
    if (state.vitals) {
      this.currentHealth = state.vitals.health;
      this.currentArmour = state.vitals.armour;
      this.setVitals(state.vitals.health, state.vitals.armour);
    }
    if (state.weapon) this.setWeapon(state.weapon);
    if (state.mission) this.setMission(state.mission);
    this.setActivity(state.activity);
  }
}
