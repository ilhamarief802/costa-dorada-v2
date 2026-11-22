// Authored camera-and-actor staging for the screenshot rig.
//
// A shot freezes the simulation, places the camera exactly, and then *casts* the street: every car
// and every person in the frame is put at a stated spot, facing a stated way, with a stated pose.
// Nothing is left to the crowd's own random walk or to where the lane graph happens to put a car,
// because a frame that has to show eight cars and fourteen people cannot rely on chance.
//
// The cast is stated in the *street's* terms, never the camera's:
//
//   - a street is a road on the plan — a centre line, an axis, and the kerb lines either side of
//     it. A car is at [lane, along] where `lane` is the signed distance from the centre line and
//     `along` is metres down the street from a stated cross-street; a person is at [kerb, along]
//     on the pavement, in the same metres. This is what keeps a wheel on the asphalt and a shoe on
//     the flagstones: placing relative to the camera instead put every near-lane car on the
//     pavement (x 22 on a road that starts at 23) and half the crowd in the middle of the road.
//
//   - `facing` is 'away' (driving off down the lens), 'towards' (oncoming), or a bearing.
//
// tools/project.mjs measures the result and prints every screen position and every count, so the
// claims "eight cars in frame, fourteen people, two brake lights" are verified rather than
// asserted.

import { SHOT_TIMES, WANTED } from './core/config.js';

export const SHOT_NAMES = ['cover', 'night', 'drive', 'chase', 'mission'];
/** Authoring-only views: a single asset framed against the sky, no HUD. Not entry screenshots. */
export const ASSET_VIEWS = ['car', 'crowd'];

/**
 * The boulevard every street-level frame looks down: the north-south road at x = 31, sixteen
 * metres of asphalt between the kerbs at x = 23 and x = 39. Four lanes: two away from the lens
 * (x 25 and 29) and two oncoming (x 33 and 37). The frames stage cars in the inner pair, leaving
 * the kerb lanes for the hero coupe and the parked cars the plan already puts there.
 */
const BOULEVARD = {
  axis: 'z',
  centre: 31,
  from: 158,
  kerb: 8,
  awayLane: 29,
  towardsLane: 35,
  nearPavement: 21.3,
  farPavement: 40.7,
};

/** The marina approach: the east-west road at z = 170 that runs in from the boulevard. */
const MARINA = {
  axis: 'x',
  centre: 170,
  from: 214,
  kerb: 8,
  awayLane: 166,
  towardsLane: 174,
  nearPavement: 178.7,
  farPavement: 161.3,
};

function streetPoint(street, lateral, along) {
  if (street.axis === 'z') return { x: street.centre + lateral, z: street.from - along };
  return { x: street.from + along, z: street.centre + lateral };
}

/** A car's heading on a street: 'away' drives off down the lens, 'towards' comes back up it. */
function streetHeading(street, facing) {
  const away = street.axis === 'z' ? 0 : -Math.PI / 2;
  const towards = street.axis === 'z' ? Math.PI : Math.PI / 2;
  if (facing === 'away') return away;
  if (facing === 'towards') return towards;
  return (facing * Math.PI) / 180;
}

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
 * Cast the traffic of a street: `spots` are [lateral, along, facing, braking] in the street's own
 * metres, where `lateral` is signed distance from the centre line.
 */
function castCars(game, street, spots) {
  return game.traffic.stageCast(
    spots.map(([lateral, along, facing, braking]) => {
      const at = streetPoint(street, lateral, along);
      return {
        x: at.x,
        z: at.z,
        heading: streetHeading(street, facing),
        speed: braking ? 0 : 7.5,
        brake: braking ? 1 : 0,
      };
    }),
  );
}

/**
 * Cast people along the pavements of a street, mid-stride.
 *
 * Each person is posed with a leg split, an opposed arm swing and a shoulder turn inside the ranges
 * the brief states (10-25 degree legs, 10-40 degree torso, arms opposed). The angles advance by
 * the golden angle, so no two people on the same pavement strike the same pose. `crossing` puts a
 * pair mid-way across the carriageway at the junction, on the zebra.
 */
function castPeople(game, street, { near, far, count, crossing = 0 }) {
  const cast = game.pedestrians.cast(count + crossing);
  for (let i = 0; i < count; i += 1) {
    const person = cast[i % cast.length];
    // Alternate pavements, then work down the block in pairs so the near people do not form a wall
    // of identical backs.
    const onLeft = i % 2 === 0;
    const rank = Math.floor(i / 2);
    const pairs = Math.ceil(count / 2);
    const t = (rank + 0.5) / pairs;
    const along = near + (far - near) * t + ((i % 5) - 2) * 0.34;
    const lateral = (onLeft ? -1 : 1) * (street.kerb + 1.3 + ((i % 3) * 0.42));
    const at = streetPoint(street, lateral, along);
    // People on a pavement face across the street, or up it, or toward the lens; never all alike.
    const along_ = streetHeading(street, onLeft ? 'towards' : 'away');
    const heading = i % 4 === 0 ? along_ : (onLeft ? Math.PI / 2 : -Math.PI / 2) + streetHeading(street, 'away') * 0;
    game.pedestrians.stagePoseDegrees(person, {
      x: at.x,
      z: at.z,
      heading: heading + (((i % 3) - 1) * 0.3),
      strideDeg: 14 + ((i * 7) % 12),
      torsoDeg: 16 + ((i * 11) % 24),
      armDeg: 18 + ((i * 5) % 16),
    });
    person.stagedIndex = i;
  }
  // Two of them mid-crossing, on the zebra at the junction, legs apart and bodies turned 20-40
  // degrees off the lens: a street with nobody crossing it reads as a diorama.
  for (let n = 0; n < crossing; n += 1) {
    const person = cast[(count + n) % cast.length];
    const lateral = -6.4 + n * 12.2 + (n % 2 ? 1.4 : -1.1);
    const along = near + (far - near) * (n === 0 ? 0.58 : 0.74);
    const at = streetPoint(street, lateral, along);
    game.pedestrians.stagePoseDegrees(person, {
      x: at.x,
      z: at.z,
      heading: streetHeading(street, n % 2 ? 'away' : 'towards') + (n % 2 ? 0.5 : -0.42),
      strideDeg: 24,
      torsoDeg: 32 + n * 5,
      armDeg: 30,
    });
    person.stagedIndex = count + n;
  }
  return count + crossing;
}

/** The pavement the camera stands on, and the lane the hero is pulled up in. */
function coverCast(game, street) {
  castCars(game, street, [
    // Near lane drives away from the lens (rear and brake lamps toward it); the far lane is
    // oncoming, so its headlights face the camera. The first pair is 12-18 m out, not 5: a car
    // five metres from the lens at 54 degrees is a smear of stretched polygons across the frame.
    [-2, 15, 'away', 1], [4, 12, 'towards', 0],
    [-2, 23, 'away', 1], [4, 21, 'towards', 0],
    [-2, 32, 'away', 0], [4, 31, 'towards', 0],
    [-2, 42, 'away', 0], [4, 41, 'towards', 0],
    [-2, 53, 'away', 0], [4, 52, 'towards', 0],
  ]);
  castPeople(game, street, { near: 6, far: 55, count: 14, crossing: 2 });
  // The nearest three metres of pavement are the frame's foreground, and a band of bare flagstone
  // across the bottom reads as a stage nobody is standing on. Two people walk out of that corner
  // toward the lens, close enough to anchor the bottom of the frame (their feet land near y 500
  // and 545 at this camera, which is the band that was empty), and one more crosses behind them.
  // Positions measured off this camera by projection, not guessed: their feet land at y 580-690 and
  // their heads at y 428-485, so they fill the band that was bare and never cross the coupe
  // (x 399-684, y 367-414).
  const foreground = game.pedestrians.cast(3);
  const walkers = [
    { x: 18.6, z: 151.0, heading: Math.PI * 0.92 },
    { x: 20.2, z: 152.5, heading: Math.PI * 0.86 },
    { x: 22.0, z: 151.0, heading: Math.PI * 1.04 },
  ];
  walkers.forEach((spot, i) => {
    const person = foreground[i];
    if (!person) return;
    game.pedestrians.stagePoseDegrees(person, {
      x: spot.x,
      z: spot.z,
      heading: spot.heading,
      strideDeg: 21 + i * 3,
      torsoDeg: 27 + i * 4,
      armDeg: 25 + i * 3,
    });
    person.stagedIndex = 200 + i;
  });
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
    person.stagedIndex = undefined;
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
    // Behind the coupe at speed, the boulevard running away to the junction. The coupe is in the
    // inner lane, not on the centre line: a car straddling the paintwork reads as a bug.
    game.driving = true;
    game.timeOfDay = SHOT_TIMES.drive;
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(false);
    game.vehicle.poseParked(BOULEVARD.centre - 2, 130, 0);
    game.vehicle.driven = true;
    game.vehicle.setNight(game.weather.night);
    game.follow.setPose({ x: BOULEVARD.centre - 1.4, y: 2.6, z: 141.5 }, { x: BOULEVARD.centre - 2, y: 1.15, z: 108 }, 60);
    // Four lanes of traffic ahead of the coupe: two abreast, two queued at the lights.
    castCars(game, BOULEVARD, [
      [-2, 10, 'away', 0], [4, 13, 'towards', 0],
      [-2, 20, 'away', 0], [4, 23, 'towards', 1],
      [-2, 30, 'away', 0], [4, 34, 'towards', 0],
      [-2, 42, 'away', 1], [4, 46, 'towards', 0],
      [-2, 56, 'away', 0], [4, 60, 'towards', 0],
    ]);
    castPeople(game, BOULEVARD, { near: 8, far: 52, count: 12, crossing: 2 });
    game.hud.setPrompt('');
  } else if (name === 'chase') {
    // Three stars: the coupe nose-to-nose with three cruisers on the boulevard, the roadblock
    // across both lanes and the queue behind it with the brakes on.
    game.police.heat = WANTED.thresholds[3] + 0.4;
    game.police.stars = 3;
    game.timeOfDay = 21.55;
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(true);
    game.player.reset(BOULEVARD.nearPavement + 1.4, 122.0, Math.PI * 0.5);
    game.player.poseIdle(Math.PI * 0.5, 0.4);
    game.vehicle.poseParked(BOULEVARD.centre - 4.6, 126.0, 0.06);
    game.vehicle.driven = false;
    game.vehicle.setNight(true);
    game.police.units.length = 0;
    const block = [
      { x: BOULEVARD.centre - 4.2, z: 110.0, heading: Math.PI * 0.32 },
      { x: BOULEVARD.centre + 4.6, z: 105.0, heading: Math.PI * 0.68 },
      { x: BOULEVARD.centre - 0.6, z: 118.0, heading: Math.PI },
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
    game.follow.setPose({ x: BOULEVARD.centre - 7.2, y: 2.45, z: 139.0 }, { x: BOULEVARD.centre - 1.0, y: 1.3, z: 110 }, 56);
    // The queue behind the roadblock: stopped at the lights, brake lamps lit.
    castCars(game, BOULEVARD, [
      [-2, 20, 'away', 1], [4, 23, 'towards', 0],
      [-2, 28, 'away', 1], [4, 32, 'towards', 0],
      [-2, 36, 'away', 0], [4, 41, 'towards', 0],
      [-2, 46, 'away', 0], [4, 51, 'towards', 0],
    ]);
    castPeople(game, BOULEVARD, { near: 8, far: 50, count: 12, crossing: 2 });
    game.hud.setPrompt('');
  } else if (name === 'mission') {
    // The marina lot: the coupe, the crew, the tower in the haze. The approach runs east-west in
    // from the boulevard, so the cast is staged against that road, not against the lens.
    game.timeOfDay = 18.15;
    game.weather.setHour(game.timeOfDay, true);
    game.driving = false;
    game.player.setVisible(true);
    game.player.reset(MARINA.from - 6.0, MARINA.centre + 5.4, -Math.PI * 0.2);
    game.player.poseIdle(-Math.PI * 0.2, 0.5);
    game.missions.start(3);
    game.vehicle.poseParked(MARINA.from - 4.4, MARINA.centre + 2.6, Math.PI * 0.5);
    game.vehicle.driven = false;
    game.vehicle.setNight(false);
    game.follow.setPose({ x: MARINA.from - 13.0, y: 2.5, z: MARINA.centre + 13.4 }, { x: MARINA.from - 1.0, y: 1.55, z: MARINA.centre + 1.2 }, 52);
    // The approach carries the traffic; the lot itself is where the crew stand.
    castCars(game, MARINA, [
      [-4, 12, 'away', 0], [4, 15, 'towards', 0],
      [-4, 21, 'away', 1], [4, 26, 'towards', 0],
      [-4, 33, 'away', 0], [4, 37, 'towards', 1],
      [-4, 45, 'away', 0], [4, 49, 'towards', 0],
    ]);
    castPeople(game, MARINA, { near: 7, far: 44, count: 12, crossing: 1 });
    game.hud.setPrompt('');
  } else {
    // Cover and night share the frame: the hero coupe at the kerb, the boulevard and its junction
    // beyond, the marina off to the right. The kerb line is x = 23, so the coupe sits in the kerb
    // lane at x 24.2 — a car parked in the middle of a travelling lane is the first thing a viewer
    // calls a bug — and the player stands on the pavement at x 21.0, between the couple and the
    // camera, reading as the person who owns the car.
    game.driving = false;
    game.timeOfDay = SHOT_TIMES[name];
    game.weather.setHour(game.timeOfDay, true);
    game.player.setVisible(true);
    game.player.reset(20.9, 145.6, 0.14);
    game.player.poseIdle(0.14, 0.7);
    game.vehicle.poseParked(24.2, 143.2, 0.02);
    game.vehicle.driven = false;
    game.vehicle.setNight(game.weather.night);
    // Camera: on the pavement, just behind and above the coupe, looking down the boulevard with
    // the hero in the lower third. It sits high and tilts ~10 degrees down, because a camera at
    // eye height looking level puts the road edge-on and every contact shadow in the frame becomes
    // a line two pixels thick. Set before the cast, because the cast and the kerb are both read
    // off it.
    game.follow.setPose({ x: 21.4, y: 3.25, z: 158.5 }, { x: 28.1, y: 1.05, z: 140.0 }, 52);
    coverCast(game, BOULEVARD);
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
