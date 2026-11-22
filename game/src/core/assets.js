// Procedural canvas textures and shared materials. Nothing is fetched: every pixel is painted
// here at boot, which keeps the game a single offline folder.

function canvas(size) {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  return element;
}

function noiseFill(ctx, size, base, spread, rng, alpha = 1) {
  const image = ctx.createImageData(size, size);
  const hex = base.replace('#', '');
  const baseR = parseInt(hex.slice(0, 2), 16);
  const baseG = parseInt(hex.slice(2, 4), 16);
  const baseB = parseInt(hex.slice(4, 6), 16);
  for (let i = 0; i < size * size; i += 1) {
    const grain = (rng.next() - 0.5) * spread * 255;
    image.data[i * 4] = Math.max(0, Math.min(255, baseR + grain));
    image.data[i * 4 + 1] = Math.max(0, Math.min(255, baseG + grain));
    image.data[i * 4 + 2] = Math.max(0, Math.min(255, baseB + grain));
    image.data[i * 4 + 3] = 255 * alpha;
  }
  ctx.putImageData(image, 0, 0);
}

export default class Assets {
  constructor(rng) {
    this.rng = rng;
    this.cache = new Map();
  }

  texture(key, painter, { repeat = 1, srgb = true } = {}) {
    if (this.cache.has(key)) return this.cache.get(key);
    const element = canvas(256);
    painter(element.getContext('2d'), 256);
    const texture = new THREE.CanvasTexture(element);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 4;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, texture);
    return texture;
  }

  asphalt() {
    return this.texture('asphalt', (ctx, size) => {
      noiseFill(ctx, size, '#4b4850', 0.09, this.rng.fork(`asphalt-${size}`));
      ctx.globalAlpha = 0.24;
      for (let i = 0; i < 90; i += 1) {
        ctx.fillStyle = this.rng.chance(0.5) ? '#1e1d21' : '#57545a';
        const w = this.rng.range(2, 26);
        ctx.fillRect(this.rng.range(0, size), this.rng.range(0, size), w, this.rng.range(1, 2));
      }
      ctx.globalAlpha = 1;
    }, { repeat: 1 });
  }

  pavement() {
    return this.texture('pavement', (ctx, size) => {
      noiseFill(ctx, size, '#b5a998', 0.11, this.rng.fork('pavement'));
      ctx.strokeStyle = 'rgba(72, 64, 55, 0.34)';
      ctx.lineWidth = 2;
      const tile = size / 4;
      for (let i = 0; i <= 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * tile, 0);
        ctx.lineTo(i * tile, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * tile);
        ctx.lineTo(size, i * tile);
        ctx.stroke();
      }
    }, { repeat: 1 });
  }

  sand() {
    return this.texture('sand', (ctx, size) => {
      noiseFill(ctx, size, '#d9bd8a', 0.15, this.rng.fork('sand'));
      ctx.globalAlpha = 0.2;
      for (let i = 0; i < 60; i += 1) {
        ctx.fillStyle = '#b09263';
        ctx.fillRect(this.rng.range(0, size), this.rng.range(0, size), this.rng.range(2, 8), 1);
      }
      ctx.globalAlpha = 1;
    }, { repeat: 1 });
  }

  glow() {
    return this.texture('glow', (ctx, size) => {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255, 240, 210, 1)');
      gradient.addColorStop(0.22, 'rgba(255, 206, 138, 0.72)');
      gradient.addColorStop(0.55, 'rgba(255, 168, 88, 0.18)');
      gradient.addColorStop(1, 'rgba(255, 160, 80, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }, { srgb: true });
  }

  /** A soft, wide falloff for contact shadows under bodies and props. White RGB with an alpha
   *  ramp, so a black material colour multiplies cleanly into a black shadow. */
  blob() {
    return this.texture('blob', (ctx, size) => {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.38, 'rgba(255, 255, 255, 0.82)');
      gradient.addColorStop(0.66, 'rgba(255, 255, 255, 0.34)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }, { srgb: false });
  }

  sign(text, { background = '#1b1622', ink = '#ffd9a0', border = '#ff9f4d', font = 700 } = {}) {
    const key = `sign:${text}:${background}:${ink}:${border}:${font}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const element = document.createElement('canvas');
    element.width = 512;
    element.height = 128;
    const ctx = element.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = border;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 492, 108);
    ctx.fillStyle = ink;
    ctx.font = `${font} 58px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '6px';
    ctx.fillText(text, 256, 68, 460);
    const texture = new THREE.CanvasTexture(element);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.cache.set(key, texture);
    return texture;
  }

  billboard(text, { background = '#121722', ink = '#f6e7c8' } = {}) {
    const key = `board:${text}:${background}:${ink}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const element = document.createElement('canvas');
    element.width = 1024;
    element.height = 256;
    const ctx = element.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, background);
    gradient.addColorStop(1, '#2b1d1c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = 'rgba(255, 190, 110, 0.16)';
    ctx.fillRect(0, 200, 1024, 10);
    ctx.fillStyle = ink;
    ctx.font = '700 96px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '12px';
    ctx.fillText(text, 512, 132, 940);
    const texture = new THREE.CanvasTexture(element);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.cache.set(key, texture);
    return texture;
  }

  dispose() {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }
}
