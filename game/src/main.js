// COSTA DORADA — boot, wiring and the fixed-step game loop. Modules own their jobs; this file
// only connects them, handles mode changes (title, play, pause, capture) and renders a frame.

import { CAMERA } from './core/config.js';
import { readSeed, makeRng } from './core/rng.js';
import GameLoop from './core/loop.js';
import Input from './core/input.js';
import Events from './core/events.js';
import Assets from './core/assets.js';
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
import Player from './entities/player.js';
import Vehicle from './entities/vehicle.js';
import Traffic from './entities/traffic.js';
import Pedestrians from './entities/pedestrian.js';
import FollowCamera from './camera/follow.js';
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdcae8c);
scene.fog = new THREE.Fog(0xdcae8c, 70, 720);
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

const sky = new Sky(scene, assets);
const terrain = new Terrain(plan, assets);
const blocks = new Blocks(plan, assets);
const water = new Water();
const roads = new Roads(plan, assets);
const buildings = new Buildings(plan, assets);
const props = new Props(plan, assets);
const palms = new Palms(plan, assets);
const landmarks = new Landmarks(plan, assets);
for (const group of [terrain.group, blocks.group, water.group, roads.group, buildings.group, props.group, palms.group, landmarks.group]) {
  scene.add(group);
}

const collision = new Collision(plan.colliders);
const traffic = new Traffic(scene, plan);
const pedestrians = new Pedestrians(scene, plan);
const player = new Player(scene, plan, rng.fork('player'), collision);
const vehicle = new Vehicle(scene, plan, assets, collision);
const weather = new Weather({ scene, renderer, sky, water, buildings, props, landmarks, traffic, vehicle });
const hud = new Hud(plan);
const menus = new Menus(seed);
const follow = new FollowCamera(camera, collision);
follow.snapToActor(player, 'foot');

const input = new Input(canvas);
input.onLockChange = (locked) => {
  if (!locked && game.started && !game.paused && !game.frozen) pauseGame();
};
player.reset(plan.playerStart.x, plan.playerStart.z, 0);

const game = {
  scene,
  camera,
  renderer,
  plan,
  assets,
  sky,
  terrain,
  water,
  roads,
  buildings,
  props,
  palms,
  landmarks,
  collision,
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
  seed,
  started: false,
  paused: false,
  frozen: false,
  driving: false,
  timeOfDay: 17.35,
  elapsed: 0,
  money: 2450,
  health: 100,
  armour: 72,
};
weather.setHour(game.timeOfDay, true);

const loop = new GameLoop({ update, render });
const perf = loop.stats;

function hudState() {
  const actor = game.driving ? vehicle : player;
  return {
    hour: game.timeOfDay,
    position: actor.position,
    heading: game.driving ? vehicle.heading : player.heading,
    cameraYaw: follow.yaw,
  };
}

function startGame() {
  if (game.started) return;
  game.started = true;
  game.paused = false;
  menus.hideTitle();
  menus.hidePause();
  hud.show(true);
  input.enabled = true;
  hud.update(0, hudState());
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
  game.driving = false;
  game.paused = false;
  menus.hidePause();
  player.setVisible(true);
  player.reset(plan.playerStart.x, plan.playerStart.z, 0);
  vehicle.reset(plan.cover.car.x, plan.cover.car.z, plan.cover.car.rot);
  vehicle.driven = false;
  follow.yaw = 0.06;
  follow.snapToActor(player, 'foot');
  game.timeOfDay = 17.35;
  weather.setHour(game.timeOfDay, true);
  hud.setPrompt('');
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
  if (!game.driving) return;
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
  weather.update(dt, game.timeOfDay);
  water.update(dt);

  const distanceToCar = Math.hypot(player.position.x - vehicle.position.x, player.position.z - vehicle.position.z);
  if (input.pressed('enter')) {
    if (game.driving) exitVehicle();
    else if (distanceToCar < 3.7 && player.grounded) enterVehicle();
  }

  if (game.driving) vehicle.update(dt, input);
  else player.update(dt, input, follow.yaw);

  follow.update(dt, game.driving ? vehicle : player, game.driving ? 'car' : 'foot', input);
  traffic.update(dt);
  pedestrians.update(dt);
  landmarks.update(dt, game.elapsed);

  const focus = game.driving ? vehicle.position : player.position;
  sky.follow(focus);

  if (game.driving) {
    hud.setPrompt(vehicle.speedKmh() < 4 ? '<b>E</b>&nbsp;&nbsp;STEP OUT' : '');
  } else if (distanceToCar < 3.7) {
    hud.setPrompt('<b>E</b>&nbsp;&nbsp;ENTER THE COUPE');
  } else {
    hud.setPrompt('');
  }
  hud.update(dt, hudState());

  input.endFrame();
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
    follow.apply(1);
    renderer.render(scene, camera);
    return;
  }
  traffic.apply(alpha);
  pedestrians.apply(alpha);
  if (!player.hidden) player.applyPose(alpha);
  vehicle.applyPose(alpha);
  follow.apply(alpha);
  renderer.render(scene, camera);
}

menus.onStart = startGame;
menus.onResume = resumeGame;
menus.onRestart = restartGame;

hud.update(0, hudState());

window.__PERF = perf;
window.__GAME = {
  scene,
  camera,
  renderer,
  plan,
  player,
  vehicle,
  follow,
  weather,
  state: () => ({
    started: game.started,
    paused: game.paused,
    driving: game.driving,
    timeOfDay: game.timeOfDay,
    player: { x: player.position.x, y: player.position.y, z: player.position.z },
    vehicle: { x: vehicle.position.x, z: vehicle.position.z },
  }),
  start: startGame,
  restart: restartGame,
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
