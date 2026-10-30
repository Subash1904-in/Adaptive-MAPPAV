/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CityLayout } from './cityMap';
import { PedestrianAgent, VehicleAgent } from '../types/simulation';

const casualColors = ['#0284c7', '#16a34a', '#ea580c', '#e11d48', '#4f46e5', '#334155'];

export interface CrosswalkZone {
  id: string;
  nodeId: string;
  axis: 'ns' | 'ew'; // 'ns': crosswalk traverses North-South road along X; 'ew': crosswalk traverses East-West road along Z
  curbA: { x: number; z: number };
  curbB: { x: number; z: number };
  roadCenter: { x: number; z: number };
}

export interface SidewalkSegment {
  from: { x: number; z: number };
  to: { x: number; z: number };
}

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

  public crosswalks: CrosswalkZone[] = [];
  public sidewalkPoints: Array<{ x: number; z: number }> = [];
  private pedestrianBaseSpeeds: Map<string, number> = new Map();
  private pedestrianCrosswalkTarget: Map<string, CrosswalkZone | null> = new Map();

  constructor(city: CityLayout, count = 30) {
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'Pedestrians_Layer';

    this.buildSidewalkAndCrosswalkNetwork();
    this.spawnInitialPedestrians(count);
  }

  /**
   * Generates structured sidewalk paths along block perimeters and designated crosswalk zones.
   * Pedestrians navigate along sidewalks and only enter the roadway at zebra crosswalks.
   */
  private buildSidewalkAndCrosswalkNetwork() {
    this.crosswalks = [];
    this.sidewalkPoints = [];

    // Road width is 14m (half road width = 7m). Curbs are placed at 9.2m outside center.
    const curbOffset = 9.2;
    const zebraDist = 10.5;

    // 1. Build Crosswalks for each intersection
    this.city.nodes.forEach((node) => {
      // North Crosswalk (crosses N-S road north of junction)
      this.crosswalks.push({
        id: `cw_n_${node.id}`,
        nodeId: node.id,
        axis: 'ns',
        curbA: { x: node.x - curbOffset, z: node.z - zebraDist },
        curbB: { x: node.x + curbOffset, z: node.z - zebraDist },
        roadCenter: { x: node.x, z: node.z - zebraDist },
      });

      // South Crosswalk (crosses N-S road south of junction)
      this.crosswalks.push({
        id: `cw_s_${node.id}`,
        nodeId: node.id,
        axis: 'ns',
        curbA: { x: node.x - curbOffset, z: node.z + zebraDist },
        curbB: { x: node.x + curbOffset, z: node.z + zebraDist },
        roadCenter: { x: node.x, z: node.z + zebraDist },
      });

      // West Crosswalk (crosses E-W road west of junction)
      this.crosswalks.push({
        id: `cw_w_${node.id}`,
        nodeId: node.id,
        axis: 'ew',
        curbA: { x: node.x - zebraDist, z: node.z - curbOffset },
        curbB: { x: node.x - zebraDist, z: node.z + curbOffset },
        roadCenter: { x: node.x - zebraDist, z: node.z },
      });

      // East Crosswalk (crosses E-W road east of junction)
      this.crosswalks.push({
        id: `cw_e_${node.id}`,
        nodeId: node.id,
        axis: 'ew',
        curbA: { x: node.x + zebraDist, z: node.z - curbOffset },
        curbB: { x: node.x + zebraDist, z: node.z + curbOffset },
        roadCenter: { x: node.x + zebraDist, z: node.z },
      });
    });

    // 2. Build Sidewalk network along city blocks
    this.crosswalks.forEach((cw) => {
      this.sidewalkPoints.push({ x: cw.curbA.x, z: cw.curbA.z });
      this.sidewalkPoints.push({ x: cw.curbB.x, z: cw.curbB.z });
    });
  }

  private spawnInitialPedestrians(count: number) {
    if (this.sidewalkPoints.length === 0) return;

    for (let i = 0; i < count; i++) {
      const id = `ped_${Math.random().toString(36).substring(2, 7)}`;
      const startIdx = Math.floor(Math.random() * this.sidewalkPoints.length);
      const startPt = this.sidewalkPoints[startIdx];

      // Pick a target sidewalk point
      let targetIdx = (startIdx + 1 + Math.floor(Math.random() * 3)) % this.sidewalkPoints.length;
      const targetPt = this.sidewalkPoints[targetIdx];

      const baseSpeed = 1.25 + Math.random() * 0.45; // 1.25 - 1.70 m/s natural walking pace
      this.pedestrianBaseSpeeds.set(id, baseSpeed);

      const color = casualColors[Math.floor(Math.random() * casualColors.length)];

      const ped: PedestrianAgent = {
        id,
        x: startPt.x + (Math.random() - 0.5) * 0.8,
        z: startPt.z + (Math.random() - 0.5) * 0.8,
        targetX: targetPt.x,
        targetZ: targetPt.z,
        speed: baseSpeed,
        heading: 0,
        status: 'walking',
        isCrossingCrosswalk: false,
        color,
        legAngle: Math.random() * Math.PI * 2,
      };

      const mesh = createPedestrianMesh(color);
      mesh.position.set(ped.x, 0, ped.z);
      this.group.add(mesh);
      this.pedestrianMeshes.set(id, mesh);
      this.pedestrians.push(ped);
    }
  }

  /**
   * Evaluates whether an approaching vehicle poses a collision risk to a pedestrian at a crosswalk.
   * If a vehicle is approaching at speed (> 1.6 m/s) within 24m, the pedestrian will WAIT on the curb.
   */
  private isVehicleApproachingCrosswalk(
    cw: CrosswalkZone,
    vehicles: VehicleAgent[]
  ): boolean {
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.speed < 0.6) continue; // Vehicle already stopped or crawling to yield

      if (cw.axis === 'ns') {
        // Vehicle travels North-South (along Z) on this road (|x - center.x| <= 7.0)
        const dx = Math.abs(v.x - cw.roadCenter.x);
        if (dx > 7.0) continue;

        const dz = cw.roadCenter.z - v.z;
        const headingZ = Math.cos(v.heading);
        const isHeadingToward = dz * headingZ > 0;
        const dist = Math.abs(dz);

        if (isHeadingToward && dist < 24.0 && v.speed > 1.6) {
          return true; // Vehicle approaching fast!
        }
      } else {
        // Vehicle travels East-West (along X) on this road (|z - center.z| <= 7.0)
        const dz = Math.abs(v.z - cw.roadCenter.z);
        if (dz > 7.0) continue;

        const dx = cw.roadCenter.x - v.x;
        const headingX = Math.sin(v.heading);
        const isHeadingToward = dx * headingX > 0;
        const dist = Math.abs(dx);

        if (isHeadingToward && dist < 24.0 && v.speed > 1.6) {
          return true; // Vehicle approaching fast!
        }
      }
    }
    return false;
  }

  /**
   * Checks whether a pedestrian is on a collision course or in the path directly ahead of a vehicle.
   */
  public getPedestrianInPath(
    vx: number,
    vz: number,
    vHeading: number,
    vSpeed: number
  ): PedestrianAgent | null {
    const forwardX = Math.sin(vHeading);
    const forwardZ = Math.cos(vHeading);
    const rightX = Math.cos(vHeading);
    const rightZ = -Math.sin(vHeading);

    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      const dx = p.x - vx;
      const dz = p.z - vz;

      const forwardDist = dx * forwardX + dz * forwardZ;
      const lateralDist = Math.abs(dx * rightX + dz * rightZ);

      // 1. Pedestrian actively crossing the road directly ahead in vehicle envelope
      if (p.isCrossingCrosswalk) {
        if (forwardDist > 0.5 && forwardDist < 20.0 && lateralDist < 5.8) {
          return p;
        }
      }

      // 2. Pedestrian waiting at the curb of an upcoming crosswalk ahead
      if (p.status === 'waiting_curb') {
        if (forwardDist > 2.0 && forwardDist < 16.0 && lateralDist < 8.5) {
          return p;
        }
      }

      // 3. Emergency direct bumper safety radius
      if (forwardDist > -0.5 && forwardDist < 6.5 && lateralDist < 3.2) {
        return p;
      }
    }

    return null;
  }

  /**
   * Updates pedestrian positions, crosswalk waiting decisions, and walking stride animations.
   */
  public update(dt: number, vehicles: VehicleAgent[] = []) {
    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      const mesh = this.pedestrianMeshes.get(p.id);
      if (!mesh) continue;

      const baseSpeed = this.pedestrianBaseSpeeds.get(p.id) || 1.4;

      const dx = p.targetX - p.x;
      const dz = p.targetZ - p.z;
      const dist = Math.hypot(dx, dz);

      // A. Arrived at target waypoint
      if (dist < 1.2) {
        if (p.status === 'crossing') {
          // Finished crossing! Safely back on sidewalk
          p.status = 'walking';
          p.isCrossingCrosswalk = false;
          this.pedestrianCrosswalkTarget.set(p.id, null);

          // Continue walking to adjacent sidewalk point
          const nextIdx = Math.floor(Math.random() * this.sidewalkPoints.length);
          const nextPt = this.sidewalkPoints[nextIdx];
          p.targetX = nextPt.x + (Math.random() - 0.5) * 1.5;
          p.targetZ = nextPt.z + (Math.random() - 0.5) * 1.5;
          p.speed = baseSpeed;
        } else {
          // At a sidewalk point: decide whether to cross a nearby zebra crosswalk (40% chance)
          let targetCw: CrosswalkZone | null = null;
          if (Math.random() < 0.45) {
            // Find a crosswalk starting near current position
            for (const cw of this.crosswalks) {
              const distA = Math.hypot(cw.curbA.x - p.x, cw.curbA.z - p.z);
              const distB = Math.hypot(cw.curbB.x - p.x, cw.curbB.z - p.z);
              if (distA < 3.5) {
                targetCw = cw;
                p.targetX = cw.curbB.x;
                p.targetZ = cw.curbB.z;
                break;
              } else if (distB < 3.5) {
                targetCw = cw;
                p.targetX = cw.curbA.x;
                p.targetZ = cw.curbA.z;
                break;
              }
            }
          }

          if (targetCw) {
            // Found a crosswalk! Stop at curb and inspect oncoming vehicular traffic
            this.pedestrianCrosswalkTarget.set(p.id, targetCw);
            p.status = 'waiting_curb';
            p.speed = 0.0;
            p.isCrossingCrosswalk = false;
          } else {
            // Continue along sidewalk
            const nextIdx = Math.floor(Math.random() * this.sidewalkPoints.length);
            const nextPt = this.sidewalkPoints[nextIdx];
            p.targetX = nextPt.x + (Math.random() - 0.5) * 1.5;
            p.targetZ = nextPt.z + (Math.random() - 0.5) * 1.5;
            p.status = 'walking';
            p.speed = baseSpeed;
            p.isCrossingCrosswalk = false;
          }
        }
      }

      // B. State execution: Waiting at curb vs Crossing vs Walking
      if (p.status === 'waiting_curb') {
        const cw = this.pedestrianCrosswalkTarget.get(p.id);
        const hasCarComing = cw ? this.isVehicleApproachingCrosswalk(cw, vehicles) : false;

        if (hasCarComing) {
          // WAIT FOR VEHICLES TO PASS! Pedestrian remains safely on sidewalk curb
          p.speed = 0.0;
          p.isCrossingCrosswalk = false;
        } else {
          // Road is clear or vehicles have yielded: step onto crosswalk and cross safely!
          p.status = 'crossing';
          p.isCrossingCrosswalk = true;
          p.speed = baseSpeed;
        }
      }

      // C. Position and Stride Kinematics
      if (p.speed > 0.05) {
        p.heading = Math.atan2(dx, dz);
        const moveDist = Math.min(dist, p.speed * dt);
        p.x += Math.sin(p.heading) * moveDist;
        p.z += Math.cos(p.heading) * moveDist;

        // Walking stride leg swing animation
        p.legAngle = (p.legAngle + dt * (p.status === 'crossing' ? 10.0 : 7.5)) % (Math.PI * 2);
        const swing = Math.sin(p.legAngle) * 0.38;
        const legL = mesh.getObjectByName('legL');
        const legR = mesh.getObjectByName('legR');
        if (legL && legR) {
          legL.rotation.x = swing;
          legR.rotation.x = -swing;
        }
      } else {
        // Standing at curb waiting for cars: legs stand straight
        const legL = mesh.getObjectByName('legL');
        const legR = mesh.getObjectByName('legR');
        if (legL && legR) {
          legL.rotation.x = 0;
          legR.rotation.x = 0;
        }
      }

      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.heading;
    }
  }

  /**
   * Checks if any pedestrian is currently crossing a road near (x, z) within radius
   */
  public isPedestrianCrossingNear(x: number, z: number, radius = 9.5): boolean {
    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      if (p.isCrossingCrosswalk) {
        const dist = Math.hypot(p.x - x, p.z - z);
        if (dist < radius) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Synchronizes pedestrian states from Python Django backend if active.
   */
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
          isCrossingCrosswalk: Boolean(bp.is_crossing_crosswalk || bp.isCrossingCrosswalk),
          color: bp.color || '#0284c7',
          legAngle: bp.leg_angle || bp.legAngle || 0,
        };
        this.pedestrians.push(p);
      }
      p.x = bp.x;
      p.z = bp.z;
      p.heading = bp.heading || 0;
      p.status = bp.status || p.status;
      p.isCrossingCrosswalk = bp.is_crossing_crosswalk !== undefined ? bp.is_crossing_crosswalk : (bp.isCrossingCrosswalk !== undefined ? bp.isCrossingCrosswalk : p.isCrossingCrosswalk);
      p.legAngle = bp.leg_angle !== undefined ? bp.leg_angle : (bp.legAngle !== undefined ? bp.legAngle : p.legAngle);

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
}
