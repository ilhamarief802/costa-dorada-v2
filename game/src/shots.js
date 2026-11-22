// Authored camera-and-actor staging for the screenshot rig. A shot freezes the simulation,
// places the camera and cast exactly, and lets main.js settle one frame before flagging ready.

import { SHOT_TIMES } from './core/config.js';

export const SHOT_NAMES = ['cover', 'night', 'drive'];

function hudState(game) {
  const actor = game.driving ? game.vehicle : game.player;
  return {
    hour: game.timeOfDay,
    position: actor.position,
    heading: game.driving ? game.vehicle.heading : game.player.heading,
    cameraYaw: game.follow.yaw,
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

  const focus = game.driving ? game.vehicle.position : game.player.position;
  game.sky.follow(focus);
  game.traffic.apply(1);
  game.pedestrians.apply(1);
  if (!game.player.hidden) game.player.applyPose(1);
  game.vehicle.applyPose(1);
  game.landmarks.update(0, 0);
  game.hud.update(0, hudState(game));
  game.follow.apply(1);
  return name;
}
