// Time of day and atmosphere. Two authored presets — golden hour and after dark — drive the
// palette, fog, sky, water, road, lit windows, street lamps and headlights together.
//
// Distance fog is keyed to the *horizon*, not to a fixed grey: the far end of the boulevard has to
// dissolve into the same band of air the sky ends in, or the skyline reads as a cut-out pasted in
// front of a painted backdrop. The density is low enough that the second layer of buildings is
// still legible and high enough that the third is only a silhouette.

import { PALETTE } from '../core/config.js';

export default class Weather {
  constructor({ scene, renderer, sky, water, buildings, props, landmarks, traffic, vehicle, roads }) {
    this.scene = scene;
    this.renderer = renderer;
    this.sky = sky;
    this.water = water;
    this.buildings = buildings;
    this.props = props;
    this.landmarks = landmarks;
    this.traffic = traffic;
    this.vehicle = vehicle;
    this.roads = roads;
    this.hour = 17.35;
    this.night = false;
    this.fogColor = new THREE.Color();
    this.palette = PALETTE.golden;
    this.scene.fog = new THREE.FogExp2(0xdcae8c, 0.0017);
    this.setHour(this.hour, true);
  }

  isNightHour(hour) {
    return hour >= 20.0 || hour < 5.7;
  }

  setHour(hour, force = false) {
    this.hour = ((hour % 24) + 24) % 24;
    const night = this.isNightHour(this.hour);
    if (!force && night === this.night) return;
    this.night = night;
    const palette = night ? PALETTE.night : PALETTE.golden;
    this.palette = palette;

    this.sky.apply(palette, night);
    this.sky.follow(this.sky.sun.target.position);
    this.water.apply(palette, night);
    this.water.setSunDirection(this.sky.sunDir);
    if (this.scene.fog) {
      // Horizon first, sun second: the air near the vanishing point is the sky's own last band,
      // warmed a little by the sun sitting in it. Nothing else may decide this colour.
      this.fogColor.set(palette.horizon).lerp(new THREE.Color(palette.sunDisc), night ? 0.06 : 0.14);
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = night ? 0.0022 : 0.00185;
    }
    this.scene.background = new THREE.Color(night ? palette.horizon : palette.clear).multiplyScalar(night ? 0.55 : 1);
    this.renderer.toneMappingExposure = palette.exposure;

    this.buildings.setNight(night);
    this.props.setNight(night);
    this.landmarks.setNight(night);
    this.traffic.setNight(night);
    if (this.roads) this.roads.setNight(night);
    if (this.vehicle) this.vehicle.setNight(night);
  }

  update(dt, hours) {
    this.hour = ((hours % 24) + 24) % 24;
    const night = this.isNightHour(this.hour);
    if (night !== this.night) this.setHour(this.hour);
  }
}
