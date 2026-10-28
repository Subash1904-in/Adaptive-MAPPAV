/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { V2VLink } from '../types/simulation';

// Cached procedural canvas textures for production-grade high-tech visual effects
let cachedRibbonTexture: THREE.CanvasTexture | null = null;
let cachedPacketTexture: THREE.CanvasTexture | null = null;

function getRibbonTexture(): THREE.CanvasTexture {
  if (cachedRibbonTexture) return cachedRibbonTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 128, 32);

  // Edge-feathered soft glow gradient across ribbon width
  const grad = ctx.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.0)');
  grad.addColorStop(0.18, 'rgba(255, 255, 255, 0.45)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.82, 'rgba(255, 255, 255, 0.45)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 32);

  // High-contrast directional forward chevrons along path length
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let x = 16; x < 128; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x - 8, 6);
    ctx.lineTo(x + 4, 16);
    ctx.lineTo(x - 8, 26);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  cachedRibbonTexture = tex;
  return tex;
}

function getPacketTexture(): THREE.CanvasTexture {
  if (cachedPacketTexture) return cachedPacketTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 64, 64);

  const radGrad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  radGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  radGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.85)');
  radGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.25)');
  radGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = radGrad;
  ctx.beginPath();
  ctx.arc(32, 32, 32, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  cachedPacketTexture = tex;
  return tex;
}

// Shared reusable materials
const ribbonMaterials = {
  selected: new THREE.MeshBasicMaterial({
    map: getRibbonTexture(),
    color: 0x00f5ff, // Radiant electric cyan
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }),
  emergency: new THREE.MeshBasicMaterial({
    map: getRibbonTexture(),
    color: 0xff1744, // Intense neon crimson
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }),
  reroute: new THREE.MeshBasicMaterial({
    map: getRibbonTexture(),
    color: 0xf59e0b, // Radiant amber
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }),
  standard: new THREE.MeshBasicMaterial({
    map: getRibbonTexture(),
    color: 0x0ea5e9, // Subtle oceanic cyan
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
};

// V2V Beam materials
const beamMaterials: Record<string, THREE.MeshBasicMaterial> = {
  cacc_platoon_sync: new THREE.MeshBasicMaterial({
    color: 0x10b981, // Vivid Emerald
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  aim_intersection_negotiate: new THREE.MeshBasicMaterial({
    color: 0xa855f7, // Neon Purple / Violet
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  eebl_emergency_brake: new THREE.MeshBasicMaterial({
    color: 0xff1744, // Crimson Hazard
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  emergency_clear: new THREE.MeshBasicMaterial({
    color: 0xef4444, // Red strobe
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  dynamic_detour: new THREE.MeshBasicMaterial({
    color: 0xf59e0b, // Amber Detour
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  default: new THREE.MeshBasicMaterial({
    color: 0x06b6d4, // Cyan blue
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
};

// Shared cylinder geometry for V2V laser beams
const unitBeamGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 8, 1, true);
unitBeamGeo.rotateX(Math.PI / 2); // Align cylinder along Z axis

// Shared packet sprite material
const packetSpriteMat = new THREE.SpriteMaterial({
  map: getPacketTexture(),
  color: 0xffffff,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

/**
 * Builds smooth floating trajectory ribbon geometry using Catmull-Rom spline.
 * Elevated at y = 0.22m to float cleanly above road asphalt with zero z-fighting.
 */
export function buildTrajectoryRibbonGeometry(
  currentPos: { x: number; z: number },
  waypoints: Array<{ x: number; z: number }>,
  ribbonWidth = 0.72
): THREE.BufferGeometry | null {
  const pts: THREE.Vector3[] = [];
  pts.push(new THREE.Vector3(currentPos.x, 0.22, currentPos.z));

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const prev = pts[pts.length - 1];
    if (Math.hypot(wp.x - prev.x, wp.z - prev.z) > 0.4) {
      pts.push(new THREE.Vector3(wp.x, 0.22, wp.z));
    }
  }

  if (pts.length < 2) return null;

  // Catmull-Rom smoothing
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const totalLen = curve.getLength();
  const numSteps = Math.min(70, Math.max(14, Math.floor(totalLen * 1.8)));
  const curvePts = curve.getPoints(numSteps);

  const halfWidth = ribbonWidth * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let cumDist = 0;
  for (let i = 0; i < curvePts.length; i++) {
    const pCurr = curvePts[i];
    if (i > 0) {
      cumDist += pCurr.distanceTo(curvePts[i - 1]);
    }

    // Tangent calculation
    let tangent: THREE.Vector3;
    if (i === 0) {
      tangent = new THREE.Vector3().subVectors(curvePts[1], pCurr).normalize();
    } else if (i === curvePts.length - 1) {
      tangent = new THREE.Vector3().subVectors(pCurr, curvePts[i - 1]).normalize();
    } else {
      tangent = new THREE.Vector3().subVectors(curvePts[i + 1], curvePts[i - 1]).normalize();
    }

    // Perpendicular vector in horizontal XZ plane
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    // Left vertex
    positions.push(pCurr.x + perp.x * halfWidth, 0.22, pCurr.z + perp.z * halfWidth);
    uvs.push(0.0, cumDist / 3.5);

    // Right vertex
    positions.push(pCurr.x - perp.x * halfWidth, 0.22, pCurr.z - perp.z * halfWidth);
    uvs.push(1.0, cumDist / 3.5);

    if (i < curvePts.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Gets cached material for ribbon type.
 */
export function getTrajectoryRibbonMaterial(
  style: 'selected' | 'emergency' | 'reroute' | 'standard'
): THREE.Material {
  return ribbonMaterials[style] || ribbonMaterials.standard;
}

/**
 * Renders glowing 3D laser beams and animated data packet pulses for V2V links.
 */
export function renderV2VBeams(
  links: V2VLink[],
  group: THREE.Group,
  animTimeSec: number
): void {
  group.clear();
  if (links.length === 0) return;

  const yElev = 1.45; // Match car roof sensor pods
  const now = animTimeSec;

  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const pFrom = new THREE.Vector3(l.fromX, yElev, l.fromZ);
    const pTo = new THREE.Vector3(l.toX, yElev, l.toZ);
    const dist = pFrom.distanceTo(pTo);
    if (dist < 0.5) continue;

    const mat = beamMaterials[l.messageType] || beamMaterials.default;

    // 1. 3D Laser Beam Mesh
    const beamMesh = new THREE.Mesh(unitBeamGeo, mat);
    const midPoint = new THREE.Vector3().addVectors(pFrom, pTo).multiplyScalar(0.5);
    beamMesh.position.copy(midPoint);
    beamMesh.lookAt(pTo);
    beamMesh.scale.set(1, 1, dist);
    group.add(beamMesh);

    // 2. Animated traveling data packet pulse along beam
    const pulseOffset = (now * 2.8 + (i * 0.35)) % 1.0;
    const packetPos = new THREE.Vector3().lerpVectors(pFrom, pTo, pulseOffset);

    const sprite = new THREE.Sprite(packetSpriteMat);
    sprite.position.copy(packetPos);
    sprite.scale.set(0.65, 0.65, 0.65);
    group.add(sprite);
  }
}
