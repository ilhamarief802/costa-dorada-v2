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
    this.scene.fog = new THREE.Fog(0xdcae8c, 75, 760);
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
      this.scene.fog.color.set(palette.fog);
      this.scene.fog.near = palette.fogNear;
      this.scene.fog.far = palette.fogFar;
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
