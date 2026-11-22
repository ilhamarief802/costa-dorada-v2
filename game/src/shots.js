// Authored camera-and-actor staging for the screenshot rig. A shot freezes the simulation, places
// the camera and cast exactly, warms the traffic and crowd so the street is full rather than
// empty, and lets main.js settle a frame before flagging ready.

import { SHOT_TIMES, WANTED } from './core/config.js';

export const SHOT_NAMES = ['cover', 'night', 'drive', 'chase', 'mission'];

function hudState(game) {
  // The authored shots can drive the hero coupe without a stolen traffic car, so read the
  // heading from whatever the player actually controls rather than assuming `stolen` exists.
  const actor = game.driving ? (game.stolen ?? game.vehicle ?? game.player) : game.player;
  return {
    hour: game.timeOfDay,
    position: actor.position,
    heading: actor.heading ?? 0,
    cameraYaw: game.follow.yaw,
    objective: game.missions.objective ?? { x: 288, z: 184 },
    stars: game.police.stars,
    money: game.money,
    vitals: { health: game.player.health, armour: game.player.armour },
    weapon: game.combat.hudState(),
    mission: game.missions.card(),
    activity: null,
  };
}

export function applyShot(game, requested) {
  const name = SHOT_NAMES.includes(requested) ? requested : 'cover';
  game.frozen = true;
  game.started = true;
  game.paused = false;
  game.menus.hideTitle();
  game.menus.hidePause();
  game.menus.title.style.display = 'none';
  game.menus.pause.style.display = 'none';
  game.hud.root.style.transition = 'none';
  game.hud.root.style.opacity = '1';
  game.hud.prompt.style.transition = 'none';
  game.hud.show(true);
  game.input.enabled = false;
  document.body.classList.add('hidden-cursor');

  // Let the city live for a few seconds before the shutter opens: cars mid-junction, people
  // mid-stride, the whole street lit.
  game.traffic.warmup(7.5);
  game.elapsed = 7.5;
  game.missions.index = 0;
  game.missions.phase = 'active';

  if (name === 'drive') {
    game.driving = true;
    game.timeOfDay = SHOT_TIMES.drive;
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(false);
    const start = { x: 31.0, z: 74, heading: 0 };
    game.vehicle.poseParked(start.x, start.z, start.heading);
    game.vehicle.driven = true;
    game.vehicle.setNight(game.weather.night);
    game.follow.setPose({ x: 31.8, y: 3.55, z: 86.5 }, { x: 30.2, y: 1.35, z: 44 }, 64);
    game.hud.setPrompt('');
  } else if (name === 'chase') {
    // Three stars, three cruisers, the hero car on the boulevard.
    game.police.heat = WANTED.thresholds[3] + 0.4;
    game.police.stars = 3;
    game.timeOfDay = 21.6;
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(true);
    game.player.reset(31.0, 96.0, Math.PI);
    game.player.poseIdle(Math.PI, 0.4);
    game.vehicle.poseParked(30.6, 104.5, 0);
    game.vehicle.driven = false;
    game.vehicle.setNight(true);
    game.police.units.length = 0;
    for (let i = 0; i < 3; i += 1) {
      const unit = game.police.spawnUnit(game.player, false);
      if (!unit) break;
      unit.x = 31 + (i - 1) * 3.4;
      unit.z = 128 + i * 12;
      unit.heading = Math.PI;
      unit.prevX = unit.x;
      unit.prevZ = unit.z;
      unit.prevHeading = unit.heading;
      unit.speed = 0;
      unit.parked = true;
    }
    game.police.officers.length = 0;
    game.follow.setPose({ x: 28.6, y: 4.1, z: 148 }, { x: 31.0, y: 1.6, z: 92 }, 62);
    game.hud.setPrompt('');
  } else if (name === 'mission') {
    game.timeOfDay = 18.35;
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(true);
    const objective = game.missions.current?.objective ?? { x: 240, z: 196 };
    game.player.reset(objective.x - 22, objective.z - 26, Math.PI * 0.8);
    game.player.poseIdle(Math.PI * 0.8, 0.5);
    game.missions.start(3);
    game.vehicle.poseParked(objective.x - 26, objective.z - 20, 0);
    game.vehicle.driven = false;
    game.vehicle.setNight(game.weather.night);
    game.follow.setPose(
      { x: objective.x - 34, y: 3.0, z: objective.z - 38 },
      { x: objective.x - 12, y: 2.2, z: objective.z - 8 },
      58,
    );
    game.hud.setPrompt('');
  } else {
    game.driving = false;
    game.timeOfDay = SHOT_TIMES[name];
    game.weather.setHour(game.timeOfDay, true);
    const cover = game.plan.cover;
    game.player.setVisible(true);
    game.player.reset(cover.player.x, cover.player.z, cover.player.rot);
    game.player.poseIdle(cover.player.rot, 0.7);
    game.vehicle.poseParked(cover.car.x, cover.car.z, cover.car.rot);
    game.vehicle.driven = false;
    game.vehicle.setNight(game.weather.night);
    const cam = cover.camera;
    game.follow.setPose(
      { x: cam.x, y: cam.y, z: cam.z },
      { x: cam.targetX, y: cam.targetY, z: cam.targetZ },
      56,
    );
    game.hud.setPrompt('<b>E</b>&nbsp;&nbsp;ENTER THE COUPE');
  }

  const focus = game.driving && game.stolen ? game.stolen.position : game.player.position;
  game.sky.follow(focus);
  game.traffic.setPlayer(null);
  game.traffic.apply(1);
  game.pedestrians.apply(1);
  game.police.applyAll(0);
  game.activities.apply();
  if (!game.player.hidden) game.player.applyPose(1);
  game.vehicle.applyPose(1);
  game.landmarks.update(0, 0);
  game.hud.update(0, hudState(game));
  game.follow.apply(1);
  return name;
}
