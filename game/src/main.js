// COSTA DORADA — boot, wiring and the fixed-step game loop. Modules own their jobs; this file
// only connects them, handles mode changes (title, play, pause, capture) and renders a frame.

import { CAMERA, HUD, WANTED } from './core/config.js';
import { formatMoney } from './core/math.js';
import { readSeed, makeRng } from './core/rng.js';
import GameLoop from './core/loop.js';
import Input from './core/input.js';
import Events from './core/events.js';
import Assets from './core/assets.js';
import { readSave, writeSave, clearSave, hasSave } from './core/save.js';
import CityPlan from './world/plan.js';
import Terrain from './world/terrain.js';
import Blocks from './world/blocks.js';
import Water from './world/water.js';
import Roads from './world/roads.js';
import Buildings from './world/buildings.js';
import Props from './world/props.js';
import Palms from './world/palms.js';
import Landmarks from './world/landmarks.js';
import Sky from './world/sky.js';
import Weather from './world/weather.js';
import Collision from './world/collision.js';
import Lanes from './world/lanes.js';
import Blobs from './world/blobs.js';
import Player from './entities/player.js';
import Vehicle from './entities/vehicle.js';
import Traffic from './entities/traffic.js';
import Pedestrians from './entities/pedestrian.js';
import FollowCamera from './camera/follow.js';
import Combat from './systems/combat.js';
import Police from './systems/police.js';
import Missions from './systems/missions.js';
import Activities from './systems/activities.js';
import Pickups from './systems/pickups.js';
import Hud from './ui/hud.js';
import Menus from './ui/menus.js';
import { applyShot } from './shots.js';

const THREE = globalThis.THREE;
if (!THREE) throw new Error('three.js failed to load');

THREE.ColorManagement.enabled = true;

const params = new URLSearchParams(window.location.search);
const seed = readSeed(window.location.search);
const shotName = params.get('shot');
const capture = params.get('capture') === '1';
const canvas = document.getElementById('game');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(1280, 720, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// ACES compresses the top of the range, which is what lets a sun disc sit next to a shaded awning
// without either clipping; exposure then decides the time of day, and the weather module owns it.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
// PCFSoft over a 2048 map: the soft variant widens the kernel, which is what turns the stair-step
// on a car's edge into a penumbra without paying for a bigger map.
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdcae8c);
scene.fog = new THREE.FogExp2(0xdcae8c, 0.0017);
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1280 / 720, CAMERA.near, CAMERA.far);
camera.position.set(0, 3, 10);

function fitCanvas() {
  const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  const width = Math.round(1280 * scale);
  const height = Math.round(720 * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = `${Math.round((window.innerWidth - width) / 2)}px`;
  canvas.style.top = `${Math.round((window.innerHeight - height) / 2)}px`;
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

const events = new Events();
const rng = makeRng(seed);
const assets = new Assets(rng.fork('assets'));
const plan = new CityPlan(seed);
const lanes = new Lanes(plan);

const sky = new Sky(scene, assets);
const terrain = new Terrain(plan, assets);
const blocks = new Blocks(plan, assets);
const water = new Water();
const roads = new Roads(plan, assets);
// Named `city` because `game.buildings` already means the module's public instance.
const cityBuildings = new Buildings(plan, assets);
const props = new Props(plan, assets);
const palms = new Palms(plan, assets);
const landmarks = new Landmarks(plan, assets);
for (const group of [terrain.group, blocks.group, water.group, roads.group, cityBuildings.group, props.group, palms.group, landmarks.group]) {
  scene.add(group);
}

const blobs = new Blobs(scene, assets, 460);
const collision = new Collision(plan.colliders);
const combat = new Combat(scene, assets, collision);
const traffic = new Traffic(scene, plan, lanes, assets, collision, blobs);
const pedestrians = new Pedestrians(scene, plan, lanes, assets, blobs, collision);
const player = new Player(scene, plan, rng.fork('player'), collision);
player.events = events;
const vehicle = new Vehicle(scene, plan, assets, collision);
// The two bodies with a scene node of their own get a real plane parented under them, carrying
// the radial-gradient canvas texture: it inherits the body's heading and height, so a parked car
// on a slope still has its shadow lying on the road.
blobs.attachPlane(vehicle.root, { width: 4.4, depth: 7.0, y: 0.09, strength: 0.95 });
blobs.attachPlane(player.root, { width: 1.7, depth: 2.3, y: 0.09, strength: 0.9 });
const police = new Police({ scene, plan, lanes, assets, collision, blobs, combat, pedestrians, traffic });
police.events = events;
const missions = new Missions({ scene, plan, assets, police, pedestrians, combat, events });
const activities = new Activities({ scene, plan, lanes, assets, traffic, blobs, events });
const pickups = new Pickups({ scene, plan, blobs, assets });
const weather = new Weather({ scene, renderer, sky, water, buildings: cityBuildings, props, landmarks, traffic, vehicle, roads });
const hud = new Hud(plan);
const menus = new Menus(seed);
const follow = new FollowCamera(camera, collision);
follow.snapToActor(player, 'foot');

const input = new Input(canvas);
input.onLockChange = (locked) => {
  if (!locked && game.started && !game.paused && !game.frozen) pauseGame();
};
player.reset(plan.playerStart.x, plan.playerStart.z, 0);
sky.follow(player.position);

// Authoring: keep the backdrop busy for the cover shot, so the boulevard reads as a living city.
props.buildContactShadows?.(blobs);
blobsPlace(blobs, plan);

const game = {
  scene,
  camera,
  renderer,
  plan,
  lanes,
  assets,
  sky,
  terrain,
  water,
  roads,
  buildings: cityBuildings,
  props,
  palms,
  landmarks,
  collision,
  blobs,
  traffic,
  pedestrians,
  player,
  vehicle,
  weather,
  hud,
  menus,
  follow,
  events,
  input,
  combat,
  police,
  missions,
  activities,
  pickups,
  seed,
  started: false,
  paused: false,
  frozen: false,
  driving: false,
  stolen: null,
  timeOfDay: 17.35,
  elapsed: 0,
  money: 2450,
  health: 100,
  armour: 72,
  deathTimer: 0,
};
weather.setHour(game.timeOfDay, true);

const loop = new GameLoop({ update, render });
const perf = loop.stats;

// A parked-car blob for every prop cluster that would otherwise float: benches, bins, shelters
// and billboards already cast real shadows, so only the four wide props get a soft one.
function blobsPlace(target, cityPlan) {
  for (const bench of cityPlan.benches) target.claim(bench.x, cityPlan.groundHeight(bench.x, bench.z) + 0.02, bench.z, 2.6, 0.22);
  for (const car of cityPlan.parked) target.claim(car.x, cityPlan.groundHeight(car.x, car.z) + 0.02, car.z, 4.4, 0.34);
}

// Two slots reserved for the bodies the player actually is: the hero coupe or a stolen car, and
// the player on foot. Written every frame from the live pose. The hero's shadow is an ellipse
// turned to its heading and stretched along the four metres of its own body, plus a darker core
// under the tyres, exactly the way traffic cast its own.
const heroBlob = blobs.claim(0, -400, 0, 0.0001);
const heroCore = blobs.claim(0, -400, 0, 0.0001);
const footBlob = blobs.claim(0, -400, 0, 0.0001);

function updateActorBlobs() {
  // The hero coupe and the player each carry their own shadow plane under their root, so their
  // shadow needs no code here: it follows the body. Only a *stolen* traffic car, which has no
  // root of its own and is drawn through the crowd's instanced mesh, is written by hand.
  if (game.driving && game.stolen) {
    const actor = game.stolen;
    const heading = actor.heading ?? 0;
    blobs.write(heroBlob, actor.position.x, actor.position.y + 0.07, actor.position.z, 4.6, 0.92, heading, 1.34);
    blobs.write(heroCore, actor.position.x, actor.position.y + 0.075, actor.position.z, 2.7, 1, heading, 1.24);
  } else {
    blobs.hide(heroBlob);
    blobs.hide(heroCore);
  }
  if (player.hidden) blobs.hide(footBlob);
  blobs.commit();
}

// Police, traffic and missions all need to know who the player currently is. While driving the
// actor is whatever car is under the player: a stolen traffic car or the hero coupe.
function focusActor() {
  if (!game.driving) return player;
  return game.stolen ?? vehicle;
}

traffic.setPlayer(null);

function hudState() {
  const actor = focusActor();
  // A running side activity takes over the compass and minimap; otherwise the mission beacon.
  const activityState = activities.hudState();
  const waypoint = (activityState && activities.beacon) ? activities.beacon : missions.objective;
  return {
    hour: game.timeOfDay,
    position: actor.position,
    heading: actor.heading ?? player.heading,
    cameraYaw: follow.yaw,
    objective: waypoint ?? HUD.objective,
    stars: police.stars,
    money: game.money,
    vitals: { health: player.health, armour: player.armour },
    weapon: combat.hudState(),
    mission: missions.card(),
    activity: activityState,
    actors: {
      cars: traffic.cars,
      people: pedestrians.people,
      units: police.units,
      markers: activities.markerMeshes.map((entry) => entry.activity.marker),
    },
  };
}

function startGame({ continue: resume = false } = {}) {
  if (game.started) return;
  game.started = true;
  game.paused = false;
  menus.hideTitle();
  menus.hidePause();
  hud.show(true);
  input.enabled = true;
  if (resume) loadGame();
  else {
    police.clear();
    missions.start(0);
  }
  hud.update(0, hudState());
}

function newGame() {
  clearSave();
  police.clear();
  game.money = 2450;
  player.health = 100;
  player.armour = 72;
  missions.index = 0;
  missions.done = new Array(8).fill(false);
  missions.phase = 'idle';
  game.timeOfDay = 17.35;
  weather.setHour(game.timeOfDay, true);
  player.setVisible(true);
  player.reset(plan.playerStart.x, plan.playerStart.z, 0);
  sky.follow(player.position);
  vehicle.reset(plan.cover.car.x, plan.cover.car.z, plan.cover.car.rot);
  vehicle.driven = false;
  exitStolen(true);
  follow.yaw = 0.06;
  follow.snapToActor(player, 'foot');
  startGame();
}

function pauseGame() {
  if (!game.started || game.paused) return;
  game.paused = true;
  menus.showPause();
  input.release();
}

function resumeGame() {
  if (!game.paused) return;
  game.paused = false;
  menus.hidePause();
}

function restartGame() {
  game.deathTimer = 0;
  police.clear();
  if (missions.phase === 'failed') missions.restart();
  else if (missions.phase !== 'active' && missions.phase !== 'complete') missions.start(0);
  if (player.health <= 0) {
    player.health = 100;
    player.armour = 40;
    player.reset(plan.playerStart.x, plan.playerStart.z, 0);
    sky.follow(player.position);
    game.paused = false;
    menus.hidePause();
    follow.snapToActor(player, 'foot');
  }
  hud.update(0, hudState());
}

function enterVehicle() {
  if (game.driving) return;
  game.driving = true;
  vehicle.driven = true;
  vehicle.applyPose(1);
  player.setVisible(false);
  follow.snapToActor(vehicle, 'car');
  vehicle.setNight(weather.night);
  events.emit('vehicle:enter');
}

function exitVehicle() {
  if (!game.driving || game.stolen) return;
  game.driving = false;
  vehicle.driven = false;
  const heading = vehicle.heading;
  const sideX = Math.cos(heading) * 1.75;
  const sideZ = -Math.sin(heading) * 1.75;
  let x = vehicle.position.x + sideX;
  let z = vehicle.position.z + sideZ;
  if (plan.isWater(x, z)) {
    x = vehicle.position.x - sideX;
    z = vehicle.position.z - sideZ;
  }
  player.setVisible(true);
  player.reset(x, z, heading + Math.PI / 2);
  follow.yaw = heading;
  follow.snapToActor(player, 'foot');
  events.emit('vehicle:exit');
}

/** Steal a traffic car: the crowd car becomes a driveable actor with its own physics. */
function stealCar(car) {
  if (!car || game.stolen) return;
  const actor = traffic.steal(car);
  if (!actor) return;
  game.stolen = actor;
  game.driving = true;
  player.setVisible(false);
  vehicle.driven = false;
  follow.snapToActor(actor, 'car');
  events.emit('vehicle:steal');
  if (!shotName) police.crime('stealInView', 1.6, { x: car.x, z: car.z });
  for (const person of pedestrians.people) {
    if (person.alive && Math.hypot(person.x - car.x, person.z - car.z) < 24) {
      pedestrians.alarm(car.x, car.z, 24, 0.9);
      break;
    }
  }
}

function exitStolen(silent = false) {
  if (!game.stolen) return;
  const actor = game.stolen;
  if (actor.car) {
    actor.car.x = actor.position.x;
    actor.car.z = actor.position.z;
    actor.car.heading = actor.heading;
    actor.car.prevX = actor.position.x;
    actor.car.prevZ = actor.position.z;
    actor.car.prevHeading = actor.heading;
    traffic.vacate(actor.car);
  }
  game.stolen = null;
  game.driving = false;
  if (!silent) {
    player.setVisible(true);
    const heading = actor.heading;
    player.reset(
      actor.position.x + Math.cos(heading) * 1.8,
      actor.position.z - Math.sin(heading) * 1.8,
      heading + Math.PI / 2,
    );
    follow.yaw = heading;
    follow.snapToActor(player, 'foot');
    events.emit('vehicle:exit');
  }
}

/** Kick off a side activity from its marker: refuses while another is running. */
function startActivity(activity) {
  if (!activity || activities.active) return false;
  const started = activities.start(activity, player);
  if (started) hud.toast(`<b>${activity.label}</b>&nbsp;&nbsp;${activity.detail}`, 3.6);
  return started;
}

function saveGame() {
  const payload = {
    money: game.money,
    health: player.health,
    armour: player.armour,
    timeOfDay: game.timeOfDay,
    position: { x: player.position.x, z: player.position.z, heading: player.heading },
    stars: police.stars,
    heat: police.heat,
    missions: missions.serialize(),
    activities: activities.serialize(),
    pickups: pickups.serialize(),
  };
  const ok = writeSave(payload);
  hud.toast(ok ? '<b>SAVED</b>&nbsp;&nbsp;COSTA DORADA' : '<b>SAVE FAILED</b>&nbsp;&nbsp;STORAGE BLOCKED', ok ? 2.2 : 3.4);
  menus.setHasSave(hasSave());
}

function loadGame() {
  const data = readSave();
  if (!data) return;
  game.money = data.money ?? 2450;
  player.health = data.health ?? 100;
  player.armour = data.armour ?? 72;
  game.timeOfDay = data.timeOfDay ?? 17.35;
  weather.setHour(game.timeOfDay, true);
  if (data.position) {
    player.setVisible(true);
    player.reset(data.position.x, data.position.z, data.position.heading ?? 0);
    sky.follow(player.position);
    follow.snapToActor(player, 'foot');
  }
  missions.restore(data.missions);
  if (missions.phase !== 'complete') missions.restart();
  if (data.heat) {
    police.heat = data.heat;
    police.stars = WANTED.heatToStars(police.heat);
  }
}

// ---------------------------------------------------------------- weapon / crime plumbing

let fireTimer = 0;

function aimRay() {
  const actor = focusActor();
  const origin = {
    x: actor.position.x,
    y: actor.position.y + (game.driving ? 1.3 : 1.45),
    z: actor.position.z,
  };
  const yaw = game.driving ? actor.heading : follow.yaw;
  const pitch = game.driving ? 0.02 : follow.pitch * -1;
  const dir = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
  // Start the ray clear of the player's own body.
  origin.x += dir.x * 0.6;
  origin.z += dir.z * 0.6;
  return { origin, dir };
}

function tryFire() {
  if (game.driving) return;
  if (fireTimer > 0) return;
  const { origin, dir } = aimRay();
  const fired = combat.fire(origin, dir);
  if (!fired) return;
  fireTimer = combat.definition().cadence * 0.6;
  player.aiming = 1;
  // Gunshots near people are a crime and send the street running.
  let crowd = 0;
  for (const person of pedestrians.people) {
    if (person.alive && Math.hypot(person.x - player.position.x, person.z - player.position.z) < 30) crowd += 1;
  }
  if (crowd >= 2) police.crime('weaponNearPeople', WANTED.crimes.weaponNearPeople);
  pedestrians.alarm(player.position.x, player.position.z, 34, 1.0);
}

combat.onShot = () => {};
combat.onHit = (target) => {
  if (target.onDamage) return;
};

// ---------------------------------------------------------------- rewards and pickups

function payout(amount, note) {
  const value = Math.max(0, Math.round(amount));
  if (value <= 0) return;
  game.money += value;
  game.earned = (game.earned ?? 0) + value;
  if (note) hud.toast(`<b>+${formatMoney(value)}</b>&nbsp;&nbsp;${note}`);
  hud.update(0, hudState());
}

events.on('mission:complete', ({ mission }) => {
  if (mission?.reward) payout(mission.reward, mission.title.toUpperCase());
});

events.on('activity:complete', ({ id, reward }) => {
  if (reward) payout(reward, String(id).toUpperCase());
});

events.on('mission:start', ({ mission }) => {
  if (mission) hud.toast(`<b>${mission.title.toUpperCase()}</b>&nbsp;&nbsp;${formatMoney(mission.reward ?? 0)}`, 3.4);
});

events.on('player:hurt', () => hud.hit());

pickups.onCollect = (item) => {
  if (item.cash) {
    payout(item.value || 120, 'CASH');
    return;
  }
  if (item.kind === 'health') {
    player.heal(item.value);
    hud.toast('<b>HEALTH</b>&nbsp;&nbsp;PICKED UP', 1.8);
  } else {
    player.addArmour(item.value);
    hud.toast('<b>ARMOUR</b>&nbsp;&nbsp;PICKED UP', 1.8);
  }
};

// ---------------------------------------------------------------- the loop

function update(dt) {
  if (game.frozen) return;

  if (!game.started) {
    if (input.pressed('confirm')) startGame();
    input.endFrame();
    return;
  }

  if (game.paused) {
    if (input.pressed('confirm') || input.pressed('pause')) resumeGame();
    else if (input.pressed('restart')) restartGame();
    else if (input.pressed('save')) saveGame();
    input.endFrame();
    return;
  }

  if (input.pressed('pause')) {
    pauseGame();
    input.endFrame();
    return;
  }

  game.timeOfDay = (game.timeOfDay + dt * 0.05) % 24;
  game.elapsed += dt;
  fireTimer = Math.max(0, fireTimer - dt);
  combat.update(dt, camera);
  weather.update(dt, game.timeOfDay);
  water.update(dt);

  const actor = focusActor();
  const onFoot = !game.driving;

  // Enter / exit / steal / start a side activity.
  if (onFoot) {
    const parkedDistance = Math.hypot(player.position.x - vehicle.position.x, player.position.z - vehicle.position.z);
    const nearCar = traffic.nearestCar(player.position.x, player.position.z, 3.6);
    const marker = activities.nearestMarker(player.position.x, player.position.z, 4.6);
    if (input.pressed('enter') && parkedDistance < 3.7 && player.grounded) enterVehicle();
    else if (input.pressed('steal') && nearCar) stealCar(nearCar);
    else if (input.pressed('steal') && marker) startActivity(marker.activity);
  } else if (input.pressed('enter')) {
    // A stolen car scatters the player; the hero coupe only lets you out when it is nearly still.
    if (game.stolen) exitStolen(false);
    else if (vehicle.speedKmh() < 6) exitVehicle();
  }

  if (game.driving) {
    if (game.stolen) {
      game.stolen.update(dt, input);
      player.position.x = game.stolen.position.x;
      player.position.z = game.stolen.position.z;
    } else {
      vehicle.update(dt, input);
    }
  } else {
    player.aiming = input.isDown('fire') ? 1 : 0;
    player.update(dt, input, follow.yaw);
  }

  // Weapon handling.
  if (input.pressed('weapon1')) combat.select('pistol');
  if (input.pressed('weapon2')) combat.select('smg');
  if (input.pressed('reload')) combat.reload();
  if (input.isDown('fire') && combat.definition().cadence < 0.2) tryFire();
  else if (input.pressed('fire')) tryFire();

  // Car hits people: heat, a shove, and the crowd scatters.
  if (game.driving) {
    const speed = game.stolen ? Math.abs(game.stolen.forwardSpeed) : Math.abs(vehicle.forwardSpeed);
    if (speed > 3.2) {
      const victim = pedestrians.nearest(actor.position.x, actor.position.z, 2.3);
      if (victim) {
        victim.onDamage(70, { source: 'car', point: { x: victim.x, y: 1.1, z: victim.z } });
        pedestrians.alarm(victim.x, victim.z, 26, 1.2);
        police.crime(victim.alive ? 'pedestrian' : 'killPedestrian', null, { x: victim.x, z: victim.z });
        pickups.dropCash(victim.x, victim.z, 0);
        if (game.stolen) {
          game.stolen.vx *= 0.7;
          game.stolen.vz *= 0.7;
        }
      }
    }
  }

  follow.update(dt, actor, game.driving ? 'car' : 'foot', input);
  traffic.update(dt, { player: onFoot ? player : null, police });
  pedestrians.update(dt);
  landmarks.update(dt, game.elapsed);
  police.update(dt, player, camera, input);
  missions.update(dt, player);
  activities.update(dt, player, game.stolen ?? vehicle, game.driving);
  pickups.update(dt, player);
  vehiclesPose();

  const focus = actor.position;
  sky.follow(focus);
  traffic.setPlayer(onFoot ? null : actor);

  // Prompts.
  if (game.driving) {
    const speed = game.stolen ? Math.abs(game.stolen.forwardSpeed) : Math.abs(vehicle.forwardSpeed);
    hud.setPrompt(speed < 1.2 ? '<b>E</b>&nbsp;&nbsp;STEP OUT' : '');
  } else {
    const parkedDistance = Math.hypot(player.position.x - vehicle.position.x, player.position.z - vehicle.position.z);
    const nearCar = traffic.nearestCar(player.position.x, player.position.z, 3.6);
    const marker = activities.nearestMarker(player.position.x, player.position.z, 4.4);
    if (marker) hud.setPrompt(`<b>F</b>&nbsp;&nbsp;START ${marker.activity.label}`);
    else if (nearCar) hud.setPrompt('<b>F</b>&nbsp;&nbsp;STEAL THE CAR');
    else if (parkedDistance < 3.7) hud.setPrompt('<b>E</b>&nbsp;&nbsp;ENTER THE COUPE');
    else hud.setPrompt('');
  }

  // Death: bleed out, then restart the run at the kerb.
  if (player.health <= 0 && !game.driving) {
    game.deathTimer += dt;
    hud.setPrompt('<b>WASTED</b>&nbsp;&nbsp;PRESS R TO RESTART');
    if (game.deathTimer > 2.4) restartGame();
  } else {
    game.deathTimer = 0;
  }

  hud.update(dt, hudState());
  input.endFrame();
}

function vehiclesPose() {
  if (game.driving && game.stolen) {
    // The stolen car is a traffic instance; write its pose straight into the slot.
    const car = game.stolen.car;
    if (car) {
      car.x = game.stolen.position.x;
      car.z = game.stolen.position.z;
      car.heading = game.stolen.heading;
    }
  }
  updateActorBlobs();
}

function render(alpha) {
  if (game.frozen) {
    follow.apply(1);
    renderer.render(scene, camera);
    return;
  }
  if (!game.started) {
    traffic.apply(1);
    pedestrians.apply(1);
    vehicle.applyPose(1);
    updateActorBlobs();
    activities.apply();
    police.applyAll(0);
    follow.apply(1);
    renderer.render(scene, camera);
    return;
  }
  traffic.apply(alpha);
  pedestrians.apply(alpha);
  activities.apply();
  police.applyAll(1 / 60);
  if (!player.hidden) player.applyPose(alpha);
  vehicle.applyPose(alpha);
  if (game.stolen) {
    // Sync the stolen car's own instance from its physics state.
    const car = game.stolen.car;
    if (car) {
      car.prevX = car.x;
      car.prevZ = car.z;
      car.prevHeading = car.heading;
      car.x = game.stolen.position.x;
      car.z = game.stolen.position.z;
      car.heading = game.stolen.heading;
      if (car.blobSlots !== undefined) {}
    }
  }
  follow.apply(alpha);
  renderer.render(scene, camera);
}

menus.onStart = () => startGame();
menus.onContinue = () => startGame({ continue: true });
menus.onNewGame = newGame;
menus.onResume = resumeGame;
menus.onRestart = restartGame;
menus.setHasSave(hasSave());

hud.update(0, hudState());

window.__PERF = perf;
// Authoring aid: the bounds of every mesh under an object, so a part that pokes out is named.
window.__PARTBOUNDS = (object) => {
  const out = [];
  object.traverse((child) => {
    if (!child.isMesh) return;
    const box = new THREE.Box3().setFromObject(child);
    out.push({
      name: child.name || child.geometry?.type || 'mesh',
      min: box.min.toArray().map((v) => Number(v.toFixed(2))),
      max: box.max.toArray().map((v) => Number(v.toFixed(2))),
      tris: (child.geometry?.index ? child.geometry.index.count : child.geometry?.getAttribute('position')?.count ?? 0) / 3,
    });
  });
  return out;
};
window.__GAME = {
  scene,
  camera,
  renderer,
  plan,
  lanes,
  buildings: cityBuildings,
  props,
  palms,
  landmarks,
  sky,
  water,
  roads,
  terrain,
  player,
  vehicle,
  traffic,
  pedestrians,
  police,
  missions,
  activities,
  combat,
  blobs,
  follow,
  weather,
  state: () => ({
    started: game.started,
    paused: game.paused,
    driving: game.driving,
    stolen: Boolean(game.stolen),
    timeOfDay: game.timeOfDay,
    stars: police.stars,
    heat: police.heat,
    money: game.money,
    health: player.health,
    armour: player.armour,
    players: traffic.cars.length,
    people: pedestrians.people.length,
    cars: traffic.cars.length,
    police: police.units.length,
    mission: missions.card(),
    player: { x: player.position.x, y: player.position.y, z: player.position.z },
    vehicle: { x: vehicle.position.x, z: vehicle.position.z },
  }),
  start: startGame,
  restart: restartGame,
  save: saveGame,
  load: loadGame,
  stealNearest: () => {
    const car = traffic.nearestCar(player.position.x, player.position.z, 8);
    if (car) stealCar(car);
    return Boolean(car);
  },
  teleport: (x, z, heading = 0) => {
    player.setVisible(game.driving);
    player.reset(x, z, heading);
    sky.follow(player.position);
    follow.snapToActor(game.driving ? focusActor() : player, game.driving ? 'car' : 'foot');
    return window.__GAME.state();
  },
  startActivity: (id) => {
    const entry = activities.markerMeshes.find((m) => m.activity.id === id);
    return entry ? startActivity(entry.activity) : false;
  },
  aimAt: (x, z) => {
    const actor = focusActor();
    follow.yaw = Math.atan2(-(x - actor.position.x), -(z - actor.position.z));
    follow.pitch = 0;
    return true;
  },
};
window.__TEST = {
  simulate(seconds, keys = []) {
    startGame();
    game.frozen = false;
    for (const key of keys) input.down.add(key);
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i += 1) update(1 / 60);
    for (const key of keys) input.down.delete(key);
    return window.__GAME.state();
  },
  hold(code, seconds) {
    input.down.add(code);
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i += 1) update(1 / 60);
    input.down.delete(code);
    return window.__GAME.state();
  },
  press(code) {
    input.edges.add(code);
    update(1 / 60);
    return window.__GAME.state();
  },
  gunshot() {
    combat.fire(aimRay().origin, aimRay().dir);
    return window.__GAME.state();
  },
  wanted(stars) {
    police.heat = WANTED.thresholds[Math.min(5, Math.max(1, stars))] + 0.1;
    police.stars = WANTED.heatToStars(police.heat);
    return window.__GAME.state();
  },
};

if (shotName) {
  applyShot(game, shotName);
  let frames = 0;
  const settle = () => {
    frames += 1;
    renderer.render(scene, camera);
    if (frames < 4) {
      requestAnimationFrame(settle);
    } else {
      window.__SHOT_READY = true;
    }
  };
  requestAnimationFrame(settle);
} else if (capture) {
  window.__SHOT_READY = true;
} else {
  loop.start();
}
