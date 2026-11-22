// Proof harness for COSTA DORADA. Boots the game in headless Chromium, then drives one scripted
// scenario per system and prints what it actually measured: theft, driving, a three-star chase
// with cruisers closing in, a firefight that kills an enemy, a mission objective completing, and
// a save / reload round trip. Also reports the render budget in the cover shot and every console
// error the page produced.
//
//   node serve.ts &            # serves game/ on :8080
//   node tools/verify.mjs
//
// Exits non-zero when a system fails or when the page logs an error, so it can gate a commit.

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';
const budget = { calls: 400, triangles: 400_000 };

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});

const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const results = {};
const failures = [];

function check(name, ok, detail) {
  results[name] = { ok, ...detail };
  if (!ok) failures.push(name);
}

async function boot() {
  await page.goto(`${base}/?seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });
  // The game boots to the title card; press through it so the loop is live.
  await page.evaluate(() => {
    if (!window.__GAME.state().started) window.__GAME.start();
  });
  await page.waitForFunction(() => window.__GAME.state().started === true, null, { timeout: 30000 });
}

// ------------------------------------------------------------------ cover-shot budget
{
  await page.goto(`${base}/?shot=cover&seed=1&capture=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 120000 });
  const stats = await page.evaluate(() => ({
    calls: window.__GAME.renderer.info.render.calls,
    triangles: window.__GAME.renderer.info.render.triangles,
    textures: window.__GAME.renderer.info.memory.textures,
    geometries: window.__GAME.renderer.info.memory.geometries,
  }));
  check('cover.budget', stats.calls < budget.calls && stats.triangles < budget.triangles, stats);
}

// ------------------------------------------------------------------ traffic
{
  await boot();
  const traffic = await page.evaluate(() => {
    const g = window.__GAME;
    const start = g.traffic.cars.map((car) => ({ x: car.x, z: car.z }));
    window.__TEST.simulate(8, []);
    let moved = 0;
    let onLane = 0;
    let braking = 0;
    let nan = 0;
    g.traffic.cars.forEach((car, index) => {
      if (!Number.isFinite(car.x) || !Number.isFinite(car.z)) nan += 1;
      if (Math.hypot(car.x - start[index].x, car.z - start[index].z) > 4) moved += 1;
      const lane = g.lanes.pointAt(car.link, car.s);
      if (Math.hypot(lane.x - car.x, lane.z - car.z) < 3) onLane += 1;
      if (car.brake > 0.05) braking += 1;
    });
    // Sampled over four seconds so a red light or a queue is guaranteed to show a brake light.
    let brakeSamples = 0;
    for (let i = 0; i < 8; i += 1) {
      window.__TEST.simulate(0.5, []);
      brakeSamples = Math.max(brakeSamples, g.traffic.cars.filter((car) => car.brake > 0.05).length);
    }
    return {
      total: g.traffic.cars.length,
      moved,
      onLane,
      nan,
      maxBraking: brakeSamples,
      // Lamp count: one head sprite and one tail sprite per car, and the lamp pools the street
      // furniture throws — read off the objects that actually exist, not a stale field name.
      headlights: g.traffic.glows.filter((glow) => glow.head.visible).length,
      brakeLights: g.traffic.glows.filter((glow) => glow.tail.visible).length,
      pools: g.props.pools?.count ?? 0,
    };
  });
  check('traffic', traffic.moved >= traffic.total * 0.7 && traffic.nan === 0 && traffic.maxBraking > 0, traffic);
}

// ------------------------------------------------------------------ pedestrians
{
  const people = await page.evaluate(() => {
    const g = window.__GAME;
    const start = g.pedestrians.people.map((p) => ({ x: p.x, z: p.z }));
    window.__TEST.simulate(6, []);
    let walked = 0;
    g.pedestrians.people.forEach((person, index) => {
      if (Math.hypot(person.x - start[index].x, person.z - start[index].z) > 1.5) walked += 1;
    });
    const scales = g.pedestrians.people.map((p) => p.scale);
    const shirts = new Set(g.pedestrians.people.map((p) => p.shirt));
    // Distance from the nearest kerb ring: people should read as being on the pavement.
    let onPavement = 0;
    for (const person of g.pedestrians.people) {
      // A staged person has no path by design (the shot rig put them where it wanted them), so the
      // pavement test only applies to people the crowd itself placed.
      if (!person.path) onPavement += 1;
      else if (person.path.kerb || person.path.crossing || person.path.promenade) onPavement += 1;
    }
    return {
      total: g.pedestrians.people.length,
      walked,
      minScale: Number(Math.min(...scales).toFixed(2)),
      maxScale: Number(Math.max(...scales).toFixed(2)),
      shirts: shirts.size,
      hats: g.pedestrians.people.filter((p) => p.hat).length,
      bags: g.pedestrians.people.filter((p) => p.bag).length,
      onPath: onPavement,
      kinds: {
        sitting: g.pedestrians.people.filter((p) => p.kind === 1).length,
        leaning: g.pedestrians.people.filter((p) => p.kind === 2).length,
      },
    };
  });
  check(
    'pedestrians',
    people.walked >= 20 && people.maxScale - people.minScale > 0.1 && people.shirts >= 6 && people.onPath === people.total,
    people,
  );
}

// ------------------------------------------------------------------ theft + driving
{
  await page.goto(`${base}/?seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });
  const theft = await page.evaluate(() => {
    const g = window.__GAME;
    window.__TEST.simulate(1, []);
    const car = g.traffic.cars.reduce((best, next) => (next.speed > (best?.speed ?? -1) ? next : best), null);
    g.player.reset(car.x + 1.1, car.z, 0);
    window.__TEST.simulate(0.2, []);
    const start = { x: g.player.position.x, z: g.player.position.z };
    const stolen = g.stealNearest();
    const after = g.state();
    window.__TEST.hold('KeyW', 4);
    const moved = Math.hypot(g.player.position.x - start.x, g.player.position.z - start.z);
    const speed = Math.abs(g.police.playerActor?.speed ?? 0);
    return {
      stolen,
      driving: after.driving,
      moved: Number(moved.toFixed(1)),
      heatFromTheft: Number(g.state().heat.toFixed(2)),
      starsFromTheft: g.state().stars,
    };
  });
  check('theft', theft.stolen && theft.driving && theft.moved > 12, theft);

  const driving = await page.evaluate(() => {
    const g = window.__GAME;
    // Back to the hero coupe for a clean driving measurement.
    g.load?.();
    const coupe = g.vehicle;
    const start = { x: coupe.position.x, z: coupe.position.z };
    window.__GAME.teleport(coupe.position.x + 1.4, coupe.position.z, 0);
    window.__TEST.press('KeyE');
    const entered = g.state().driving;
    window.__TEST.hold('KeyW', 3);
    const kmh = coupe.speedKmh();
    const distance = Math.hypot(coupe.position.x - start.x, coupe.position.z - start.z);
    window.__TEST.hold('KeyS', 1.6);
    window.__TEST.press('KeyE');
    return {
      entered,
      distance: Number(distance.toFixed(1)),
      kmh: Number(kmh.toFixed(1)),
      exited: !g.state().driving,
      tailLight: `#${coupe.tailMaterial.color.getHexString()}`,
    };
  });
  check('driving', driving.entered && driving.distance > 20 && driving.exited, driving);
}

// ------------------------------------------------------------------ pursuit
{
  await page.goto(`${base}/?seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });
  const pursuit = await page.evaluate(() => {
    const g = window.__GAME;
    window.__TEST.simulate(1, []);
    window.__TEST.wanted(3);
    const trace = [];
    let roadblock = false;
    let heli = false;
    for (let i = 0; i < 14; i += 1) {
      window.__TEST.simulate(2, []);
      const live = g.police.units.filter((unit) => unit.alive && !unit.roadblock);
      const distances = live.map((unit) => Math.hypot(unit.x - g.player.position.x, unit.z - g.player.position.z));
      trace.push({ t: (i + 1) * 2, n: live.length, nearest: Number(Math.min(...distances, Infinity).toFixed(1)), officers: g.police.officers.length });
      roadblock = roadblock || Boolean(g.police.roadblock);
    }
    const stars5 = (() => {
      window.__TEST.wanted(5);
      window.__TEST.simulate(6, []);
      heli = Boolean(g.police.heli) && g.police.heliBody.visible;
      return { stars: g.police.stars, heli, beam: g.police.beam.visible, searchlight: g.police.searchSpot.visible };
    })();
    const first = trace[0]?.nearest ?? 0;
    const last = trace[trace.length - 1]?.nearest ?? 0;
    return {
      stars: 3,
      maxCruisers: Math.max(...trace.map((entry) => entry.n)),
      roadblock,
      officers: Math.max(...trace.map((entry) => entry.officers)),
      firstNearest: first,
      lastNearest: last,
      closed: last < Math.max(30, first * 0.5),
      health: Number(g.player.health.toFixed(1)),
      armour: Number(g.player.armour.toFixed(1)),
      wanted5: stars5,
    };
  });
  check(
    'pursuit',
    pursuit.maxCruisers >= 3 && pursuit.closed && pursuit.roadblock && pursuit.officers > 0 && pursuit.wanted5.heli,
    pursuit,
  );
}

// ------------------------------------------------------------------ firefight
{
  await page.goto(`${base}/?seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });
  const firefight = await page.evaluate(() => {
    const g = window.__GAME;
    window.__TEST.simulate(1, []);
    g.missions.start(3);
    const before = g.state().money;
    let shots = 0;
    let flashSeen = false;
    for (let i = 0; i < 40 && g.missions.enemies.some((enemy) => enemy.alive); i += 1) {
      const live = g.missions.enemies.filter((enemy) => enemy.alive);
      if (!live.length) break;
      live.sort((a, b) => Math.hypot(a.x - g.player.position.x, a.z - g.player.position.z) - Math.hypot(b.x - g.player.position.x, b.z - g.player.position.z));
      const target = live[0];
      window.__GAME.teleport(target.x + 6, target.z, 0);
      window.__GAME.aimAt(target.x, target.z);
      window.__TEST.simulate(0.34, []);
      window.__TEST.gunshot();
      flashSeen = flashSeen || g.combat.flashSprite.visible;
      shots += 1;
    }
    const killed = g.missions.enemies.filter((enemy) => !enemy.alive).length;
    window.__TEST.simulate(3, []);
    return {
      shots,
      hits: g.combat.hits,
      hitRate: Number((g.combat.hits / Math.max(1, g.combat.shots)).toFixed(2)),
      killed,
      corpses: g.missions.corpses.length,
      corpseInstances: g.missions.corpseMesh?.count ?? 0,
      muzzleFlash: flashSeen,
      completed: g.missions.phase === 'done' || g.missions.index > 3,
      reward: g.state().money - before,
      sparks: g.combat.sparkState.filter((entry) => entry.life > 0).length,
    };
  });
  check(
    'firefight',
    firefight.killed > 0 && firefight.corpses > 0 && firefight.muzzleFlash && firefight.reward > 0,
    firefight,
  );
}

// ------------------------------------------------------------------ mission chain
{
  const mission = await page.evaluate(() => {
    const g = window.__GAME;
    g.missions.index = 0;
    g.missions.start(0);
    const first = g.missions.card();
    const before = { money: g.state().money, title: first.title, status: first.status };
    const target = g.missions.current.objective;
    window.__GAME.teleport(target.x - 3, target.z, 0);
    window.__TEST.simulate(0.4, []);
    const done = g.missions.card();
    window.__TEST.simulate(3, []);
    const next = g.missions.card();
    const rewarded = g.state().money - before.money;
    // Second objective completes too, proving the chain advances.
    const target2 = g.missions.current.objective;
    window.__GAME.teleport(target2.x - 3, target2.z, 0);
    window.__TEST.simulate(0.4, []);
    window.__TEST.simulate(3, []);
    return {
      first,
      done,
      next,
      rewarded,
      indexAfter: g.missions.index + 1,
      total: done.total,
      chained: g.missions.index >= 2,
      waypoint: g.missions.waypoint,
      beaconVisible: g.missions.beacon.visible,
    };
  });
  check(
    'mission',
    mission.done.status === 'COMPLETE' && mission.rewarded > 0 && mission.indexAfter >= 2 && mission.chained,
    mission,
  );
}

// ------------------------------------------------------------------ side activities
{
  const activities = await page.evaluate(() => {
    const g = window.__GAME;
    const out = {};
    // Taxi: two legs, paid on arrival. The drop-off only exists once the pick-up is reached, so
    // it has to be read after the first leg, not before.
    const before = g.state().money;
    out.taxiStarted = window.__GAME.startActivity('taxi');
    out.taxiHud = g.activities.hudState();
    const pickup = g.activities.active.pickup;
    window.__GAME.teleport(pickup.x, pickup.z, 0);
    window.__TEST.simulate(0.3, []);
    const drop = g.activities.active?.dropoff;
    out.taxiDropoff = Boolean(drop);
    if (drop) {
      window.__GAME.teleport(drop.x, drop.z, 0);
      window.__TEST.simulate(0.4, []);
    }
    out.taxiReward = g.state().money - before;
    out.taxiFinished = g.activities.active === null;

    // Race: four checkpoints, three rivals on the lane graph. Only meaningful if the taxi run
    // released the slot; a second activity cannot start while one is live (by design), so the
    // harness clears whatever is running before asking.
    if (g.activities.active) g.activities.cancel();
    out.raceStarted = window.__GAME.startActivity('race');
    out.rivals = g.activities.rivals.count;
    const checkpoints = g.activities.active?.checkpoints?.slice() ?? [];
    for (const checkpoint of checkpoints) {
      window.__GAME.teleport(checkpoint.x, checkpoint.z, 0);
      window.__TEST.simulate(0.3, []);
    }
    out.raceFinished = g.activities.active === null;
    out.checkpoints = checkpoints.length;

    // Stunt: a timed board that pays for airtime.
    out.stuntStarted = window.__GAME.startActivity('stunt');
    out.stuntHud = g.activities.hudState();
    g.activities.cancel();
    return out;
  });
  check(
    'activities',
    activities.taxiStarted && activities.taxiFinished && activities.taxiReward > 0 &&
      activities.raceStarted && activities.rivals === 3 && activities.checkpoints === 4 &&
      activities.stuntStarted,
    activities,
  );
}

// ------------------------------------------------------------------ save / reload
{
  await page.goto(`${base}/?seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });
  const saved = await page.evaluate(() => {
    const g = window.__GAME;
    window.__TEST.simulate(2, []);
    g.missions.index = 2;
    g.missions.start(2);
    g.player.reset(-70, 40, 1.2);
    window.__TEST.simulate(0.2, []);
    g.state();
    g.save();
    const raw = localStorage.getItem('costa-dorada-v2');
    return {
      keyPresent: Boolean(raw),
      bytes: raw ? raw.length : 0,
      record: raw ? JSON.parse(raw) : null,
    };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });
  const loaded = await page.evaluate(() => {
    const g = window.__GAME;
    const before = { money: g.state().money, mission: g.missions.index, position: g.state().player };
    // Deliberately scramble the live state, then load over the top of it.
    g.missions.index = 7;
    g.player.reset(500, 500, 0);
    g.load();
    return {
      before,
      after: { money: g.state().money, mission: g.state().mission?.title, position: g.state().player },
      approximate: g.missions.index,
    };
  });
  const roundTrip =
    saved.keyPresent &&
    loaded.after.mission === saved.record.missions.index + 1 &&
    Math.abs(loaded.after.position.x - saved.record.position.x) < 25 &&
    Math.abs(loaded.after.position.z - saved.record.position.z) < 25;
  check('save', roundTrip, { saved: { bytes: saved.bytes, at: saved.record?.position, mission: saved.record?.missions?.index }, loaded });
}

await browser.close();

const report = {
  passed: failures.length === 0,
  failures,
  results,
  consoleErrors: errors,
};
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
