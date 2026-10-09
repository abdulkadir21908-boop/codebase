/* Geometry helpers.
   three's mergeGeometries() refuses to mix indexed and non-indexed
   inputs (BoxGeometry is indexed, ExtrudeGeometry and
   RoundedBoxGeometry are not), so normalise everything first. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv', 'color'];

export function mergeParts(list) {
  const parts = [];
  for (const g of list) {
    if (!g) continue;
    const n = g.index ? g.toNonIndexed() : g;
    for (const key of Object.keys(n.attributes)) {
      if (!KEEP.includes(key)) n.deleteAttribute(key);
    }
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) {
      n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    }
    if (n.attributes.color && n.attributes.color.count !== n.attributes.position.count) {
      n.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 3), 3));
    }
    parts.push(n);
  }
  if (!parts.length) return new THREE.BufferGeometry();
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts, false);
  if (!merged) {
    console.warn('mergeParts failed for', parts.length, 'geometries');
    return parts[0];
  }
  return merged;
}
