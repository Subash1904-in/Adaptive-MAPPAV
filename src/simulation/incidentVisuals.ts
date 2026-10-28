/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { Incident } from '../types/simulation';
import { createVehicleMesh } from './vehicleFactory';

export interface IncidentVisualObject {
  group: THREE.Group;
  update?: (dt: number) => void;
}

/**
 * Creates realistic 3D vehicle crash incident with two collided crumpled cars,
 * scattered debris, and rising billow smoke particles.
 */
export function createRealisticCrashIncident(incident: Incident): IncidentVisualObject {
  const group = new THREE.Group();
  group.name = incident.id;

  // Car 1: Crushed Sedan tilted
  const car1 = createVehicleMesh('sedan', '#dc2626');
  car1.rotation.y = 0.65;
  car1.rotation.z = 0.12;
  car1.position.set(-1.2, 0, 0);
  group.add(car1);

  // Car 2: Collided SUV smashed into Car 1's side
  const car2 = createVehicleMesh('suv', '#1e293b');
  car2.rotation.y = -1.1;
  car2.rotation.x = -0.08;
  car2.position.set(1.4, 0, 0.4);
  group.add(car2);

  // Scattered debris pieces
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
  const glassShardMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.6 });

  for (let i = 0; i < 8; i++) {
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.25), debrisMat);
    chunk.position.set((Math.random() - 0.5) * 5, 0.05, (Math.random() - 0.5) * 5);
    chunk.rotation.y = Math.random() * Math.PI;
    group.add(chunk);

    const shard = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), glassShardMat);
    shard.rotation.x = -Math.PI / 2;
    shard.position.set((Math.random() - 0.5) * 6, 0.06, (Math.random() - 0.5) * 6);
    group.add(shard);
  }

  // Warning Flares & Hazard Triangles
  const flareGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.4, 6);
  const flareMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const flarePositions = [
    { x: -incident.radius * 0.7, z: -incident.radius * 0.5 },
    { x: incident.radius * 0.7, z: -incident.radius * 0.5 },
    { x: 0, z: incident.radius * 0.7 },
  ];

  flarePositions.forEach((pos) => {
    const flare = new THREE.Mesh(flareGeo, flareMat);
    flare.position.set(pos.x, 0.2, pos.z);
    group.add(flare);

    const flareLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), flareMat);
    flareLight.position.set(pos.x, 0.4, pos.z);
    group.add(flareLight);
  });

  // Perimeter Warning Disc
  const ringGeo = new THREE.RingGeometry(incident.radius * 0.95, incident.radius, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);

  // Animated Smoke Particle System
  const particleCount = 45;
  const smokePositions = new Float32Array(particleCount * 3);
  const smokeSpeeds: number[] = [];

  for (let i = 0; i < particleCount; i++) {
    smokePositions[i * 3] = (Math.random() - 0.5) * 1.5;
    smokePositions[i * 3 + 1] = 1.0 + Math.random() * 5.0;
    smokePositions[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    smokeSpeeds.push(1.5 + Math.random() * 2.0);
  }

  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smokeMat = new THREE.PointsMaterial({
    color: 0x64748b,
    size: 0.85,
    transparent: true,
    opacity: 0.45,
  });
  const smokeParticles = new THREE.Points(smokeGeo, smokeMat);
  group.add(smokeParticles);

  group.position.set(incident.x, 0, incident.z);

  const update = (dt: number) => {
    const pos = smokeGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3 + 1] += smokeSpeeds[i] * dt;
      pos[i * 3] += (Math.random() - 0.5) * 0.2 * dt;
      if (pos[i * 3 + 1] > 7.5) {
        pos[i * 3 + 1] = 1.0;
        pos[i * 3] = (Math.random() - 0.5) * 1.5;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      }
    }
    smokeGeo.attributes.position.needsUpdate = true;
  };

  return { group, update };
}

/**
 * Creates realistic Traffic Jam Shockwave Incident with pulsing accordion rings & congestion warning sign
 */
export function createTrafficJamIncident(incident: Incident): IncidentVisualObject {
  const group = new THREE.Group();
  group.name = incident.id;

  // Outer Advisory Deceleration Field Ring (R + 22m)
  const advisoryRadius = incident.radius + 22.0;
  const advisoryGeo = new THREE.RingGeometry(advisoryRadius - 0.6, advisoryRadius, 48);
  const advisoryMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.28,
  });
  const advisoryRing = new THREE.Mesh(advisoryGeo, advisoryMat);
  advisoryRing.rotation.x = -Math.PI / 2;
  advisoryRing.position.y = 0.04;
  group.add(advisoryRing);

  // Middle Compression Shockwave Ring
  const ringGeo = new THREE.RingGeometry(incident.radius * 0.75, incident.radius, 36);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);

  // Inner Bottleneck Queue Core
  const innerGeo = new THREE.RingGeometry(0.1, incident.radius * 0.45, 32);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.45,
  });
  const innerRing = new THREE.Mesh(innerGeo, innerMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.06;
  group.add(innerRing);

  // Roadside Electronic Variable Message Board (VMS)
  const signGroup = new THREE.Group();
  signGroup.position.set(incident.radius * 0.55, 0, incident.radius * 0.55);

  const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 3.6, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x475569 });
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.y = 1.8;
  signGroup.add(post);

  const boardGeo = new THREE.BoxGeometry(2.4, 1.4, 0.3);
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
  const board = new THREE.Mesh(boardGeo, boardMat);
  board.position.y = 3.6;
  signGroup.add(board);

  // LED Screen face
  const screenGeo = new THREE.PlaneGeometry(2.2, 1.2);
  const screenMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, 3.6, 0.16);
  signGroup.add(screen);

  // Amber warning beacons on sign
  const beaconGeo = new THREE.SphereGeometry(0.2, 8, 8);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  const beacon1 = new THREE.Mesh(beaconGeo, beaconMat);
  beacon1.position.set(-1.0, 4.4, 0.1);
  const beacon2 = new THREE.Mesh(beaconGeo, beaconMat);
  beacon2.position.set(1.0, 4.4, 0.1);
  signGroup.add(beacon1, beacon2);

  group.add(signGroup);

  group.position.set(incident.x, 0, incident.z);

  let timer = 0;
  const update = (dt: number) => {
    timer += dt * 3.5;
    const pulse = 1.0 + Math.sin(timer) * 0.15;
    ring.scale.set(pulse, pulse, 1);
    const innerPulse = 1.0 + Math.cos(timer * 1.5) * 0.2;
    innerRing.scale.set(innerPulse, innerPulse, 1);
    const advPulse = 1.0 + Math.sin(timer * 0.7) * 0.05;
    advisoryRing.scale.set(advPulse, advPulse, 1);

    // Flashing LED beacons
    const flash = Math.sin(timer * 4.0) > 0;
    beaconMat.color.setHex(flash ? 0xf59e0b : 0x78350f);
  };

  return { group, update };
}
