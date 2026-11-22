// Geometry assembly helpers. three.js' global build ships no BufferGeometryUtils, so the few
// places that need one mesh out of many primitives use the merge written here.

const scratch = new THREE.Object3D();

/** Concatenate geometries into one non-indexed BufferGeometry, optionally tinted per part. */
export function mergeGeometries(parts) {
  const prepared = [];
  let total = 0;

  for (const part of parts) {
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (part.matrix) source.applyMatrix4(part.matrix);
    const count = source.getAttribute('position').count;
    prepared.push({ geometry: source, count, color: part.color });
    total += count;
  }

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);
  const white = new THREE.Color(0xffffff);
  let offset = 0;
  let tinted = false;

  for (const { geometry, count, color: tint } of prepared) {
    const pos = geometry.getAttribute('position');
    const nrm = geometry.getAttribute('normal');
    const tex = geometry.getAttribute('uv');
    position.set(pos.array, offset * 3);
    if (nrm) normal.set(nrm.array, offset * 3);
    if (tex) uv.set(tex.array, offset * 2);
    const c = tint === undefined ? white : tint instanceof THREE.Color ? tint : new THREE.Color(tint);
    if (tint !== undefined) tinted = true;
    for (let i = 0; i < count; i += 1) {
      color[(offset + i) * 3] = c.r;
      color[(offset + i) * 3 + 1] = c.g;
      color[(offset + i) * 3 + 2] = c.b;
    }
    offset += count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (tinted) merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** A box geometry with its origin at the base centre. */
export function boxAtBase(width, height, depth, x = 0, y = 0, z = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y + height / 2, z);
  return geometry;
}

/** Build one InstancedMesh from placement records and (optionally) per-instance colours. */
export function makeInstances(geometry, material, placements, options = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  mesh.count = placements.length;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.frustumCulled = options.frustumCulled ?? false;
  const color = new THREE.Color();
  placements.forEach((placement, index) => {
    scratch.position.set(placement.x ?? 0, placement.y ?? 0, placement.z ?? 0);
    scratch.rotation.set(placement.rx ?? 0, placement.ry ?? 0, placement.rz ?? 0);
    const scale = placement.scale;
    if (Array.isArray(scale)) scratch.scale.set(scale[0], scale[1], scale[2]);
    else if (typeof scale === 'number') scratch.scale.setScalar(scale);
    else scratch.scale.set(1, 1, 1);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
    if (placement.color !== undefined) {
      color.set(placement.color);
      mesh.setColorAt(index, color);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/** A flat XZ quad facing up, for road paint and detritus. */
export function groundQuad(width, depth, x, y, z, rotation = 0) {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(rotation);
  geometry.translate(x, y, z);
  return geometry;
}
