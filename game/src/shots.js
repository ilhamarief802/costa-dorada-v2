// Authored camera-and-actor staging for the screenshot rig.
//
// A shot freezes the simulation, places the camera exactly, and then *casts* the street: every car
// and every person in the frame is put at a stated spot, facing a stated way, with a stated pose.
// Nothing here is left to the crowd's own random walk or to where the lane graph happens to put a
// car, because a frame that has to show six cars and ten people at 480 px cannot rely on chance.
//
// The cast is described in the road's own terms:
//   - cars sit on the carriageways of the boulevard the camera is looking down, at stated depths,
//     with their brake lamps in a stated state;
//   - people walk the pavements on both sides, mid-stride, legs 10-25 degrees apart, arms opposed,
//     shoulders turned 10-40 degrees against the hips.
//
// tools/project.mjs measures the result and prints every screen position and every count, so the
// claims "at least 6 cars, at least 10 people, two brake lights" are verified rather than asserted.

import { SHOT_TIMES, WANTED } from './core/config.js';

export const SHOT_NAMES = ['cover', 'night', 'drive', 'chase', 'mission'];
/** Authoring-only views: a single asset framed against the sky, no HUD. Not entry screenshots. */
export const ASSET_VIEWS = ['car', 'crowd'];

/** The verge the camera stands on, and the carriageway it looks down. */
const LANE_A = 28.4;
const LANE_B = 33.6;
const PAVE_W = 21.2;
const PAVE_E = 40.8;

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
 * The camera's own frame, so a cast can be stated in the terms a frame is composed in: `depth`
 * metres in front of the lens, `lateral` metres to its right. A shot staged this way cannot end
 * up behind the camera, which is what happens when a street's world coordinates are guessed.
 */
function cameraFrame(game) {
  const camera = game.camera;
  camera.updateMatrixWorld();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  // Flatten the look onto the ground plane: cars and people are placed at street level, so the
  // ground-plane basis is what matters, and it keeps the two sides of the street parallel.
  const flat = new THREE.Vector3(forward.x, 0, forward.z).normalize();
  const right = new THREE.Vector3(-flat.z, 0, flat.x);
  const origin = new THREE.Vector3(camera.position.x, 0, camera.position.z);
  const place = (depth, lateral) => ({
    x: origin.x + flat.x * depth + right.x * lateral,
    z: origin.z + flat.z * depth + right.z * lateral,
  });
  // A car's own forward axis is (-sin h, -cos h), so a heading that makes it drive *away* down the
  // lens is atan2(-flat.x, -flat.z), and the heading that makes it drive back toward the camera is
  // the opposite. Getting these the wrong way round puts every "braking" car's brake lamps on the
  // far side of its body, where nothing can see them.
  const away = Math.atan2(-flat.x, -flat.z);
  const towards = Math.atan2(flat.x, flat.z);
  return { place, towards, away, flat, right, origin };
}

/**
 * Cast the cars of the frame the camera is actually looking at: `spots` are [depth, lateral,
 * facing, braking] in the camera's own frame, where facing is 'away' (driving off), 'towards'
 * (oncoming) or a bearing in degrees.
 */
function castCars(game, frame, spots) {
  return game.traffic.stageCast(
    spots.map(([depth, lateral, facing, braking]) => {
      const at = frame.place(depth, lateral);
      const heading = facing === 'away' ? frame.away : facing === 'towards' ? frame.towards : (facing * Math.PI) / 180;
      return { x: at.x, z: at.z, heading, speed: braking ? 0 : 7.5, brake: braking ? 1 : 0 };
    }),
  );
}

/**
 * Cast people along both pavements of the street the camera looks down.
 *
 * Each person is posed mid-stride with a leg split, an opposed arm swing and a shoulder turn, all
 * inside the ranges the brief states (10-25 degrees legs, 10-40 degrees torso, arms opposed). The
 * angles advance by the golden angle, so no two people on the same pavement strike the same pose.
 */
function castPeople(game, frame, { near, far, count, left = -6.6, right = 6.6, faceCamera = false }) {
  const cast = game.pedestrians.cast(count);
  for (let i = 0; i < count; i += 1) {
    const person = cast[i % cast.length];
    // Alternate pavements, then work down the block in pairs so the near people do not form a wall
    // of identical backs.
    const onLeft = i % 2 === 0;
    const rank = Math.floor(i / 2);
    const pairs = Math.ceil(count / 2);
    const t = (rank + 0.5) / pairs;
    const depth = near + (far - near) * t;
    const sway = ((i % 5) - 2) * 0.5;
    const at = frame.place(depth + sway * 0.6, (onLeft ? left : right) + sway * 0.3);
    // People on a pavement face across the street, or up it, or toward the lens; never all alike.
    const along = i % 4 === 0 ? (onLeft ? frame.towards : frame.away) : (onLeft ? Math.PI / 2 : -Math.PI / 2);
    const facingBase = faceCamera ? Math.atan2(frame.origin.x - at.x, frame.origin.z - at.z) : along;
    game.pedestrians.stagePoseDegrees(person, {
      x: at.x,
      z: at.z,
      heading: facingBase + (((i % 3) - 1) * 0.3),
      strideDeg: 14 + ((i * 7) % 12),
      torsoDeg: 16 + ((i * 11) % 24),
      armDeg: 18 + ((i * 5) % 16),
    });
    person.stagedIndex = i;
  }
  return count;
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

  // Clear every cast from a previous shot, so a frame is only ever the cast it declares.
  for (const car of game.traffic.cars) {
    car.castAt = false;
    car.staged = false;
  }
  for (const person of game.pedestrians.people) {
    person.stageStride = undefined;
    person.stageTorso = undefined;
    person.stageArm = undefined;
  }

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
    game.follow.setPose({ x: 31.5, y: 2.9, z: 141 }, { x: 31.0, y: 1.2, z: 112 }, 62);
    // Four lanes of traffic ahead of the coupe: two abreast, two queued at the lights.
    castCars(game, cameraFrame(game), [
      [10, -2.4, 'away', 0], [13, 2.4, 'towards', 0],
      [20, -2.4, 'away', 0], [23, 2.4, 'towards', 1],
      [30, -2.4, 'away', 0], [34, 2.4, 'towards', 0],
      [42, -2.4, 'away', 1], [46, 2.4, 'towards', 0],
      [56, -2.4, 'away', 0], [60, 2.4, 'towards', 0],
    ]);
    castPeople(game, cameraFrame(game), { near: 7, far: 46, count: 12, left: -9.0, right: 9.0 });
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
    game.follow.setPose({ x: 24.4, y: 2.35, z: 140.5 }, { x: 30.0, y: 1.35, z: 112 }, 58);
    // The queue behind the roadblock: stopped at the lights, brake lamps lit.
    castCars(game, cameraFrame(game), [
      [9, -2.6, 'away', 1], [12, 2.6, 'towards', 0],
      [17, -2.6, 'away', 1], [21, 2.6, 'towards', 0],
      [27, -2.6, 'away', 0], [31, 2.6, 'towards', 0],
      [38, -2.6, 'away', 0], [43, 2.6, 'towards', 0],
    ]);
    castPeople(game, cameraFrame(game), { near: 6, far: 44, count: 14, left: -9.4, right: 9.4 });
    game.hud.setPrompt('');
  } else if (name === 'mission') {
    // The marina lot: the coupe, the crew, the tower in the haze. The lot is the marina approach,
    // which runs north along x = 236 from the coastal boulevard.
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
    game.follow.setPose({ x: spot.x - 15.0, y: 2.55, z: spot.z + 14.5 }, { x: spot.x - 2.0, y: 1.7, z: spot.z + 1.0 }, 54);
    // The approach carries the traffic; the lot itself is where the crew stand.
    castCars(game, cameraFrame(game), [
      [12, -3.0, 'away', 0], [15, 3.0, 'towards', 0],
      [21, -3.0, 'away', 1], [25, 3.0, 'towards', 0],
      [32, -3.0, 'away', 0], [36, 3.0, 'towards', 1],
      [44, -3.0, 'away', 0], [48, 3.0, 'towards', 0],
    ]);
    castPeople(game, cameraFrame(game), { near: 8, far: 40, count: 12, left: -8.6, right: 8.6 });
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
    // Camera: on the pavement, just behind and left of the coupe, looking up the boulevard. Set
    // before the cast, because the cast is expressed in the camera's own frame.
    game.follow.setPose({ x: 22.6, y: 1.72, z: 154.0 }, { x: 28.4, y: 1.05, z: 118.0 }, 54);
    // The boulevard: a queue in the near lane with the brakes on, a moving column beyond it.
    castCars(game, cameraFrame(game), [
      // Near lane drives away from the lens (rear and brake lamps toward it); the far lane is
      // oncoming, so its headlights face the camera.
      [11, -2.5, 'away', 1], [15, 2.5, 'towards', 0],
      [19, -2.5, 'away', 1], [24, 2.5, 'towards', 0],
      [27, -2.5, 'away', 0], [33, 2.5, 'towards', 0],
      [36, -2.5, 'away', 0], [42, 2.5, 'towards', 0],
      [46, -2.5, 'away', 0], [53, 2.5, 'towards', 0],
    ]);
    castPeople(game, cameraFrame(game), { near: 6, far: 48, count: 14, left: -8.2, right: 8.2 });
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
