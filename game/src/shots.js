// Authored camera-and-actor staging for the screenshot rig. A shot freezes the simulation, places
// the camera and the cast exactly, stages traffic on the lanes that the camera is actually looking
// at, warms the crowd so the pavement is full rather than empty, and lets main.js settle a frame
// before flagging ready.
//
// The rule every shot follows: the camera looks down a boulevard into a junction. The hero subject
// is close and large, the junction is 15-40 m out, and every car and person in that space is
// staged explicitly rather than left to chance.

import { SHOT_TIMES, WANTED } from './core/config.js';

export const SHOT_NAMES = ['cover', 'night', 'drive', 'chase', 'mission'];
/** Authoring-only views: a single asset framed against the sky, no HUD. Not entry screenshots. */
export const ASSET_VIEWS = ['car', 'crowd'];

/** The junction every shot frames: the boulevard crossing north of the marina. */
const JUNCTION = { x: 31, z: 93 };

function hudState(game) {
  const actor = game.driving ? (game.stolen ?? game.vehicle ?? game.player) : game.player;
  const objective = game.missions.objective ?? { x: 288, z: 184 };
  return {
    hour: game.timeOfDay,
    position: actor.position,
    heading: actor.heading ?? 0,
    cameraYaw: game.follow.yaw,
    objective,
    stars: game.police.stars,
    money: game.money,
    vitals: { health: game.player.health, armour: game.player.armour },
    weapon: game.combat.hudState(),
    mission: game.missions.card(),
    activity: null,
    actors: {
      cars: game.traffic.cars,
      people: game.pedestrians.people,
      units: game.police.units,
      markers: [],
    },
  };
}

/**
 * Populate the lanes between a camera and a look-at point. Cars are placed at graduated distances
 * from the camera (so a third of them are close enough to read at 480 px) and snapped onto the
 * nearest lane, alternating carriageways. Some are queued with their brakes on, which is what
 * makes traffic read as traffic instead of as scattered props.
 */
function stageStreet(game, { from, lookAt, count = 9, near = 7, far = 46, seed = 1 }) {
  const dx = lookAt.x - from.x;
  const dz = lookAt.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  const fx = dx / length;
  const fz = dz / length;
  const placed = [];
  for (let i = 0; i < count; i += 1) {
    // Bias the queue toward the camera: a frame needs cars at 10-25 m, not an even scatter out to
    // the horizon. t^1.7 puts six of twelve inside the first third of the range.
    const t = Math.pow(i / Math.max(1, count - 1), 1.7);
    const distance = near + (far - near) * t;
    // Alternate carriageways, and stagger the lanes so neither reads as a single file.
    const lateral = ((i % 2) * 2 - 1) * (2.6 + (i % 3) * 1.2);
    const x = from.x + fx * distance - fz * lateral;
    const z = from.z + fz * distance + fx * lateral;
    const car = game.traffic.stage(x, z, { radius: 8, speed: 0 });
    if (!car || placed.includes(car)) continue;
    placed.push(car);
    // Queue: the near half is braking or stopped, the far half is at speed.
    if (t < 0.45) {
      car.speed = t < 0.22 ? 0 : 2.4;
      car.brake = 1;
      car.brakeFade = 1;
    } else {
      car.speed = 8 + ((i * 7 + seed) % 7);
      car.brake = 0;
      car.brakeFade = 0;
    }
    car.limit = Math.max(car.limit, car.speed);
    car.wheelSpin = (i * 1.7 + seed) % 6.28;
  }
  return placed;
}

/**
 * Cars crossing the junction on the cross street, plus a couple turning into it. A frame with only
 * one direction of traffic reads as a queue; a junction needs movement across the lens as well.
 */
function stageCrossing(game, { center, count = 4, spacing = 11 }) {
  const placed = [];
  for (let i = 0; i < count; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = center.x + (i - count / 2) * spacing;
    const z = center.z + side * 2.6;
    const car = game.traffic.stage(x, z, { radius: 7, speed: 0 });
    if (!car || placed.includes(car)) continue;
    placed.push(car);
    car.speed = 7 + (i % 4) * 2.1;
    car.limit = Math.max(car.limit, car.speed);
    car.brake = 0;
    car.brakeFade = 0;
    car.wheelSpin = (i * 2.3) % 6.28;
  }
  return placed;
}

/** Walk the crowd into view of a camera: everyone in a radius is nudged onto the near pavements. */
function stageCrowd(game, { center, radius = 55, pairs = 2 }) {
  const people = game.pedestrians.people.filter((person) => person.alive);
  let moved = 0;
  for (const person of people) {
    if (Math.hypot(person.x - center.x, person.z - center.z) > radius) continue;
    moved += 1;
  }
  void pairs;
  return moved;
}

export function applyShot(game, requested) {
  const asset = ASSET_VIEWS.includes(requested);
  const name = asset ? requested : SHOT_NAMES.includes(requested) ? requested : 'cover';
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
  if (asset) {
    game.hud.root.style.display = 'none';
    const vignette = document.getElementById('vignette');
    if (vignette) vignette.style.display = 'none';
  }

  // Let the city live for a few seconds before the shutter opens: cars mid-junction, people
  // mid-stride, the whole street lit.
  game.traffic.warmup(6.0);
  game.elapsed = 6.0;
  game.missions.index = 0;
  game.missions.phase = 'active';

  if (name === 'car') {
    game.timeOfDay = 17.35;
    game.weather.setHour(game.timeOfDay, true);
    game.driving = false;
    game.player.setVisible(false);
    game.vehicle.poseParked(31.0, 186.0, Math.PI * 0.5);
    game.vehicle.driven = false;
    game.vehicle.setNight(false);
    game.follow.setPose({ x: 35.4, y: 1.5, z: 182.6 }, { x: 31.0, y: 0.72, z: 186.0 }, 44);
    game.hud.setPrompt('');
  } else if (name === 'crowd') {
    game.timeOfDay = 17.35;
    game.weather.setHour(game.timeOfDay, true);
    game.driving = false;
    game.player.setVisible(false);
    game.vehicle.poseParked(400, 400, 0);
    game.follow.setPose({ x: 33.2, y: 1.28, z: 106.4 }, { x: 35.4, y: 0.98, z: 98.0 }, 52);
    game.hud.setPrompt('');
  } else if (name === 'drive') {
    // Behind the coupe at speed, the boulevard running away to the junction.
    game.driving = true;
    game.timeOfDay = SHOT_TIMES.drive;
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(false);
    game.vehicle.poseParked(31.0, 130, 0);
    game.vehicle.driven = true;
    game.vehicle.setNight(game.weather.night);
    stageStreet(game, { from: { x: 31.5, z: 141 }, lookAt: { x: 31, z: 96 }, count: 12, near: 5, far: 48, seed: 3 });
    stageCrossing(game, { center: { x: 30, z: 96 }, count: 4, spacing: 12 });
    game.follow.setPose({ x: 31.5, y: 2.9, z: 141 }, { x: 31.0, y: 1.2, z: 112 }, 62);
    game.hud.setPrompt('');
  } else if (name === 'chase') {
    // Three stars: the coupe nose-to-nose with three cruisers on the boulevard.
    game.police.heat = WANTED.thresholds[3] + 0.4;
    game.police.stars = 3;
    game.timeOfDay = 21.55;
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(true);
    game.player.reset(31.6, 122.0, Math.PI * 0.5);
    game.player.poseIdle(Math.PI * 0.5, 0.4);
    game.vehicle.poseParked(26.4, 128.5, 0);
    game.vehicle.driven = false;
    game.vehicle.setNight(true);
    game.police.units.length = 0;
    const block = [
      { x: 27.2, z: 106.0, heading: 0 },
      { x: 34.8, z: 101.0, heading: Math.PI * 0.06 },
      { x: 31.0, z: 118.0, heading: Math.PI },
    ];
    for (const spot of block) {
      const unit = game.police.spawnUnit(game.player, false);
      if (!unit) break;
      unit.x = spot.x;
      unit.z = spot.z;
      unit.heading = spot.heading;
      unit.prevX = unit.x;
      unit.prevZ = unit.z;
      unit.prevHeading = unit.heading;
      unit.speed = 0;
      unit.parked = true;
    }
    game.police.officers.length = 0;
    stageStreet(game, { from: { x: 24.4, z: 140.5 }, lookAt: { x: 31, z: 96 }, count: 10, near: 5, far: 44, seed: 5 });
    stageCrossing(game, { center: { x: 30, z: 96 }, count: 3, spacing: 12 });
    game.follow.setPose({ x: 24.4, y: 2.35, z: 140.5 }, { x: 30.0, y: 1.35, z: 112 }, 58);
    game.hud.setPrompt('');
  } else if (name === 'mission') {
    // The marina lot: the coupe, the crew, the tower in the haze.
    game.timeOfDay = 18.15;
    game.weather.setHour(game.timeOfDay, true);
    game.driving = false;
    game.player.setVisible(true);
    const spot = { x: 232, z: 168 };
    game.player.reset(spot.x - 1.6, spot.z + 5.0, Math.PI * 0.94);
    game.player.poseIdle(Math.PI * 0.94, 0.5);
    game.missions.start(3);
    game.vehicle.poseParked(spot.x - 8.5, spot.z + 3.0, Math.PI * 0.5);
    game.vehicle.driven = false;
    game.vehicle.setNight(false);
    stageStreet(game, { from: { x: spot.x - 15.0, z: spot.z + 14.5 }, lookAt: { x: 224, z: 166 }, count: 9, near: 5, far: 32, seed: 7 });
    game.follow.setPose({ x: spot.x - 15.0, y: 2.55, z: spot.z + 14.5 }, { x: spot.x - 2.0, y: 1.7, z: spot.z + 1.0 }, 54);
    game.hud.setPrompt('');
  } else {
    // Cover and night share the frame: the hero coupe at the kerb, the boulevard and its junction
    // beyond, the marina off to the right.
    game.driving = false;
    game.timeOfDay = SHOT_TIMES[name];
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(true);
    game.player.reset(28.2, 145.0, 0.12);
    game.player.poseIdle(0.12, 0.7);
    game.vehicle.poseParked(25.4, 143.5, 0.02);
    game.vehicle.driven = false;
    game.vehicle.setNight(game.weather.night);
    stageStreet(game, {
      from: { x: 22.6, z: 154.0 },
      lookAt: { x: 28.4, z: 118.0 },
      count: 12,
      near: 7,
      far: 52,
      seed: name === 'cover' ? 2 : 4,
    });
    stageCrossing(game, { center: { x: 27, z: 93 }, count: 4, spacing: 13 });
    // Camera: on the pavement, just behind and left of the coupe, looking up the boulevard.
    game.follow.setPose({ x: 22.6, y: 1.72, z: 154.0 }, { x: 28.4, y: 1.05, z: 118.0 }, 54);
    game.hud.setPrompt('<b>E</b>&nbsp;&nbsp;ENTER THE COUPE');
  }

  stageCrowd(game, { center: { x: 30, z: 120 }, radius: 60 });

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
