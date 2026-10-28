/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CityLayout } from './cityMap';
import { PedestrianAgent } from '../types/simulation';

const casualColors = ['#0284c7', '#16a34a', '#ea580c', '#e11d48', '#4f46e5', '#334155'];

function createPedestrianMesh(colorHex: string): THREE.Group {
  const group = new THREE.Group();

  const shirtMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.7,
  });

  const pantsMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.8,
  });

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    roughness: 0.5,
  });

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.65, 0.25), shirtMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skinMat);
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);

  // Legs (Left & Right)
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), pantsMat);
  legL.position.set(-0.12, 0.35, 0);
  legL.name = 'legL';
  legL.castShadow = true;

  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), pantsMat);
  legR.position.set(0.12, 0.35, 0);
  legR.name = 'legR';
  legR.castShadow = true;

  group.add(legL, legR);

  // Soft contact shadow
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.35, 8),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  return group;
}

export class PedestrianManager {
  public group: THREE.Group;
  public pedestrians: PedestrianAgent[] = [];
  public pedestrianMeshes: Map<string, THREE.Group> = new Map();
  public city: CityLayout;
  private sidewalkPoints: Array<{ x: number; z: number }> = [];

  constructor(city: CityLayout, count = 28) {
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'Pedestrians_Layer';

    this.buildSidewalkGrid();
    this.spawnInitialPedestrians(count);
  }

  private buildSidewalkGrid() {
    // Generate valid sidewalk perimeter points around city blocks
    this.city.intersections.forEach((pt) => {
      const offsets = [
        { x: pt.x - 9, z: pt.z - 9 },
        { x: pt.x + 9, z: pt.z - 9 },
        { x: pt.x - 9, z: pt.z + 9 },
        { x: pt.x + 9, z: pt.z + 9 },
      ];
      this.sidewalkPoints.push(...offsets);
    });
  }

  private spawnInitialPedestrians(count: number) {
    for (let i = 0; i < count; i++) {
      const id = `ped_${Math.random().toString(36).substring(2, 7)}`;
      const ptIdx = Math.floor(Math.random() * this.sidewalkPoints.length);
      const startPt = this.sidewalkPoints[ptIdx] || { x: 0, z: 0 };

      let nextIdx = Math.floor(Math.random() * this.sidewalkPoints.length);
      const targetPt = this.sidewalkPoints[nextIdx] || { x: 20, z: 20 };

      const color = casualColors[Math.floor(Math.random() * casualColors.length)];

      const ped: PedestrianAgent = {
        id,
        x: startPt.x + (Math.random() - 0.5) * 3,
        z: startPt.z + (Math.random() - 0.5) * 3,
        targetX: targetPt.x,
        targetZ: targetPt.z,
        speed: 1.2 + Math.random() * 0.5, // 1.2 - 1.7 m/s walking speed
        heading: 0,
        status: 'walking',
        isCrossingCrosswalk: Math.random() < 0.35,
        color,
        legAngle: 0,
      };

      const mesh = createPedestrianMesh(color);
      mesh.position.set(ped.x, 0, ped.z);
      this.group.add(mesh);
      this.pedestrianMeshes.set(id, mesh);
      this.pedestrians.push(ped);
    }
  }

  public syncFromBackend(backendPedestrians: any[]) {
    backendPedestrians.forEach((bp) => {
      let p = this.pedestrians.find((item) => item.id === bp.id);
      let mesh = this.pedestrianMeshes.get(bp.id);
      if (!p) {
        p = {
          id: bp.id,
          x: bp.x,
          z: bp.z,
          targetX: bp.x,
          targetZ: bp.z,
          speed: bp.speed || 1.4,
          heading: bp.heading || 0,
          status: bp.status || 'walking',
          isCrossingCrosswalk: Boolean(bp.isCrossingCrosswalk),
          color: bp.color || '#0284c7',
          legAngle: bp.legAngle || 0,
        };
        this.pedestrians.push(p);
      }
      p.x = bp.x;
      p.z = bp.z;
      p.heading = bp.heading || 0;
      p.status = bp.status || p.status;
      p.isCrossingCrosswalk = bp.isCrossingCrosswalk !== undefined ? bp.isCrossingCrosswalk : p.isCrossingCrosswalk;
      p.legAngle = bp.legAngle !== undefined ? bp.legAngle : p.legAngle;

      if (mesh) {
        mesh.position.set(p.x, 0, p.z);
        mesh.rotation.y = p.heading;
        const swing = Math.sin(p.legAngle) * 0.35;
        const legL = mesh.getObjectByName('legL');
        const legR = mesh.getObjectByName('legR');
        if (legL && legR) {
          legL.rotation.x = swing;
          legR.rotation.x = -swing;
        }
      }
    });
  }

  public update(dt: number) {
    for (const p of this.pedestrians) {
      const mesh = this.pedestrianMeshes.get(p.id);
      if (!mesh) continue;

      const dx = p.targetX - p.x;
      const dz = p.targetZ - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 1.5) {
        // Pick new random destination sidewalk point
        const nextIdx = Math.floor(Math.random() * this.sidewalkPoints.length);
        const nextPt = this.sidewalkPoints[nextIdx];
        p.targetX = nextPt.x + (Math.random() - 0.5) * 2;
        p.targetZ = nextPt.z + (Math.random() - 0.5) * 2;
        p.isCrossingCrosswalk = Math.random() < 0.35;
      } else {
        p.heading = Math.atan2(dx, dz);
        const moveDist = p.speed * dt;
        p.x += Math.sin(p.heading) * moveDist;
        p.z += Math.cos(p.heading) * moveDist;

        // Walking stride animation
        p.legAngle += dt * 8.0;
        const swing = Math.sin(p.legAngle) * 0.35;
        const legL = mesh.getObjectByName('legL');
        const legR = mesh.getObjectByName('legR');
        if (legL && legR) {
          legL.rotation.x = swing;
          legR.rotation.x = -swing;
        }
      }

      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.heading;
    }
  }

  /**
   * Checks if any pedestrian is currently crossing a road near (x, z)
   */
  public isPedestrianCrossingNear(x: number, z: number, radius = 8.5): boolean {
    for (const p of this.pedestrians) {
      if (p.isCrossingCrosswalk) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (Math.sqrt(dx * dx + dz * dz) < radius) {
          return true;
        }
      }
    }
    return false;
  }
}
