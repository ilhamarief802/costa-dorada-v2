// Time of day and atmosphere. Two authored presets — golden hour and after dark — drive the
// palette, fog, sky, water, lit windows, street lamps and headlights together.

import { PALETTE } from '../core/config.js';

export default class Weather {
  constructor({ scene, renderer, sky, water, buildings, props, landmarks, traffic, vehicle }) {
    this.scene = scene;
    this.renderer = renderer;
    this.sky = sky;
    this.water = water;
    this.buildings = buildings;
    this.props = props;
    this.landmarks = landmarks;
    this.traffic = traffic;
    this.vehicle = vehicle;
    this.hour = 17.35;
    this.night = false;
    this.fogColor = new THREE.Color();
    this.palette = PALETTE.golden;
    // Exponential haze, not a linear wall: distance bleeds into the sun's own colour so the
    // skyline dissolves into the same light the sky is lit by.
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
      const sunTint = new THREE.Color(palette.sun);
      this.fogColor.set(palette.fog).lerp(sunTint, night ? 0.16 : 0.34);
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = night ? 0.0024 : 0.00165;
    }
    this.scene.background = new THREE.Color(palette.clear);
    this.renderer.toneMappingExposure = palette.exposure;

    this.buildings.setNight(night);
    this.props.setNight(night);
    this.landmarks.setNight(night);
    this.traffic.setNight(night);
    if (this.vehicle) this.vehicle.setNight(night);
  }

  update(dt, hours) {
    this.hour = ((hours % 24) + 24) % 24;
    const night = this.isNightHour(this.hour);
    if (night !== this.night) this.setHour(this.hour);
  }
}
