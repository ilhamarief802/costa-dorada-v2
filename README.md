# Costa Dorada

A sun-bleached coastal crime sandbox that runs in a browser tab. One continuous city — beach,
promenade, marina, art-deco side streets and a downtown you can see from the harbour — is generated
from a seed in the URL. Walk it, take the coupe, drive it.

The game is plain ES modules on top of a vendored three.js build: no bundler, no network calls, no
external assets. Every texture is painted into a canvas at boot, every building, window, palm, lamp
and parked car is placed by the seeded city plan, and the simulation runs on a fixed 1/60 s step so
a seed reproduces the same street.

## Play

```
node serve.ts
```

Then open `http://localhost:8080/?seed=1`. Any number after `seed` is a different city.

| Input | Action |
| --- | --- |
| W A S D | move relative to the camera |
| Shift | sprint |
| C | crouch |
| Space | jump |
| E | enter / leave the coupe |
| Mouse | look (pointer lock; click the scene to capture the pointer) |
| Esc | pause |
| Enter | start, resume |
| R | restart from the kerb while paused |

## Captured views

Add `shot=<name>&capture=1` to freeze a staged frame:

- `?shot=cover&seed=1&capture=1` — golden hour on the boulevard, the coupe at the kerb.
- `?shot=night&seed=1&capture=1` — the same corner after dark.
- `?shot=drive&seed=1&capture=1` — the chase camera mid-boulevard.

The page sets `window.__SHOT_READY` once the frame has settled.

## Structure

```
game/
  index.html            page shell (three.js classic, main.js module)
  style.css             HUD, title and pause typography
  vendor/three.min.js   the library
  src/
    core/               config, seeded rng, maths, loop, input, assets, events
    world/              plan, terrain, blocks, roads, buildings, props, palms,
                        water, landmarks, sky, weather, collision
    entities/           player, vehicle, traffic, pedestrians
    camera/             follow and chase rig
    ui/                 hud, minimap, menus
```

`main.ts` copies `game/` and `screenshots/` into `/output` and writes the make.fun dossier. To build
outside the grader:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```
