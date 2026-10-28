/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CityLayout } from './cityMap';
import { IntersectionTrafficLight, MapNode, OccupancySensorState, SignalLightColor, VehicleAgent } from '../types/simulation';

export const STRICT_CYCLE_DURATION = 52.0; // Strictly 52.0-second urban cycle
export const PHASE_NS_GREEN = 20.0;
export const PHASE_NS_YELLOW = 4.0;
export const PHASE_NS_ALL_RED = 2.0;
export const PHASE_EW_GREEN = 20.0;
export const PHASE_EW_YELLOW = 4.0;
export const PHASE_EW_ALL_RED = 2.0;
export const HALF_CYCLE = 26.0; // 20 + 4 + 2

export interface SignalHeadMeshRef {
  boxMesh: THREE.Mesh;
  redLens: THREE.Mesh;
  yellowLens: THREE.Mesh;
  greenLens: THREE.Mesh;
  axis: 'ns' | 'ew';
}

export interface StopBarSensorMeshRef {
  barMesh: THREE.Mesh;
  sensorMesh: THREE.Mesh;
  axis: 'ns' | 'ew';
  nodeId: string;
}

export interface VehicleSignalResponse {
  hasSignal: boolean;
  isRedOrYellow: boolean;
  travelAxis: 'ns' | 'ew';
  distToIntersection: number;
  distToStopBar: number;
  mustDecelerate: boolean;
  mustFullStop: boolean;
  targetDecelSpeed: number;
  statusRule: string;
}

const lampOffMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.8,
});

const redOnMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
const yellowOnMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
const greenOnMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

// Stop bar white marking material
const stopBarWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  roughness: 0.4,
  metalness: 0.1,
});

// Induction loop sensor materials
const sensorGreenMat = new THREE.MeshBasicMaterial({
  color: 0x059669,
  transparent: true,
  opacity: 0.45,
});

const sensorYellowMat = new THREE.MeshBasicMaterial({
  color: 0xd97706,
  transparent: true,
  opacity: 0.55,
});

const sensorRedIdleMat = new THREE.MeshBasicMaterial({
  color: 0x7f1d1d,
  transparent: true,
  opacity: 0.5,
});

const sensorRedActiveMat = new THREE.MeshBasicMaterial({
  color: 0xef4444,
  transparent: true,
  opacity: 0.9,
});

export class TrafficSignalManager {
  public group: THREE.Group;
  private signalHeads: Map<string, SignalHeadMeshRef[]> = new Map();
  private stopBarSensors: StopBarSensorMeshRef[] = [];
  public city: CityLayout;
  public totalPreemptions = 0;

  // Real-time approach occupancy tracking maps
  private activeScanOccupancy: Map<
    string,
    {
      ns: OccupancySensorState;
      ew: OccupancySensorState;
    }
  > = new Map();

  constructor(city: CityLayout) {
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'Traffic_Signals_Network';

    this.initializeSignals();
  }

  /**
   * Strictly evaluates the 52.0-second 6-phase cycle timing.
   * Phase 1: NS Green  (20.0s) [0.0s  -> 20.0s)
   * Phase 2: NS Yellow (4.0s)  [20.0s -> 24.0s)
   * Phase 3: All-Red   (2.0s)  [24.0s -> 26.0s)  (Inter-green clearance hold)
   * Phase 4: EW Green  (20.0s) [26.0s -> 46.0s)
   * Phase 5: EW Yellow (4.0s)  [46.0s -> 50.0s)
   * Phase 6: All-Red   (2.0s)  [50.0s -> 52.0s)  (Inter-green clearance hold)
   */
  public static evaluateCyclePhase(timer: number): {
    nsState: SignalLightColor;
    ewState: SignalLightColor;
    phaseIndex: number;
    phaseName: string;
    phaseTimeRemaining: number;
  } {
    const t = ((timer % STRICT_CYCLE_DURATION) + STRICT_CYCLE_DURATION) % STRICT_CYCLE_DURATION;

    if (t < PHASE_NS_GREEN) {
      return {
        nsState: 'green',
        ewState: 'red',
        phaseIndex: 1,
        phaseName: 'North-South Green',
        phaseTimeRemaining: Number((PHASE_NS_GREEN - t).toFixed(1)),
      };
    } else if (t < PHASE_NS_GREEN + PHASE_NS_YELLOW) {
      return {
        nsState: 'yellow',
        ewState: 'red',
        phaseIndex: 2,
        phaseName: 'North-South Yellow Caution',
        phaseTimeRemaining: Number((PHASE_NS_GREEN + PHASE_NS_YELLOW - t).toFixed(1)),
      };
    } else if (t < HALF_CYCLE) {
      return {
        nsState: 'red',
        ewState: 'red',
        phaseIndex: 3,
        phaseName: 'All-Red Clearance Hold (NS Transition)',
        phaseTimeRemaining: Number((HALF_CYCLE - t).toFixed(1)),
      };
    } else if (t < HALF_CYCLE + PHASE_EW_GREEN) {
      return {
        nsState: 'red',
        ewState: 'green',
        phaseIndex: 4,
        phaseName: 'East-West Green',
        phaseTimeRemaining: Number((HALF_CYCLE + PHASE_EW_GREEN - t).toFixed(1)),
      };
    } else if (t < HALF_CYCLE + PHASE_EW_GREEN + PHASE_EW_YELLOW) {
      return {
        nsState: 'red',
        ewState: 'yellow',
        phaseIndex: 5,
        phaseName: 'East-West Yellow Caution',
        phaseTimeRemaining: Number((HALF_CYCLE + PHASE_EW_GREEN + PHASE_EW_YELLOW - t).toFixed(1)),
      };
    } else {
      return {
        nsState: 'red',
        ewState: 'red',
        phaseIndex: 6,
        phaseName: 'All-Red Clearance Hold (EW Transition)',
        phaseTimeRemaining: Number((STRICT_CYCLE_DURATION - t).toFixed(1)),
      };
    }
  }

  private initializeSignals() {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
    const boxGeo = new THREE.BoxGeometry(0.7, 2.0, 0.7);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
    const lensGeo = new THREE.SphereGeometry(0.22, 10, 10);

    // Stop-bar line & occupancy induction loop geometries
    const stopBarGeoNS = new THREE.PlaneGeometry(3.6, 0.5);
    const sensorGeoNS = new THREE.PlaneGeometry(3.2, 2.4);
    const stopBarGeoEW = new THREE.PlaneGeometry(0.5, 3.6);
    const sensorGeoEW = new THREE.PlaneGeometry(2.4, 3.2);

    this.city.nodes.forEach((node, nodeId) => {
      // Deterministic, strict 52.0-second cycle initialization
      const parts = nodeId.split('_');
      const gx = parseInt(parts[1] || '0', 10);
      const gz = parseInt(parts[2] || '0', 10);

      // Grid coordination: alternate 0.0s (NS green) and 26.0s (EW green) across adjacent nodes
      const initialTimer = (gx + gz) % 2 === 0 ? 0.0 : HALF_CYCLE;
      const initialPhase = TrafficSignalManager.evaluateCyclePhase(initialTimer);

      node.trafficLight = {
        nsState: initialPhase.nsState,
        ewState: initialPhase.ewState,
        timer: initialTimer,
        cycleDuration: STRICT_CYCLE_DURATION,
        phaseIndex: initialPhase.phaseIndex,
        phaseName: initialPhase.phaseName,
        phaseTimeRemaining: initialPhase.phaseTimeRemaining,
        emergencyOverrideAxis: null,
        emergencyOverrideTimer: 0,
        nsOccupancy: { occupied: false, vehicleCount: 0, leadDist: 999, holdActive: false },
        ewOccupancy: { occupied: false, vehicleCount: 0, leadDist: 999, holdActive: false },
      };

      this.activeScanOccupancy.set(nodeId, {
        ns: { occupied: false, vehicleCount: 0, leadDist: 999, holdActive: false },
        ew: { occupied: false, vehicleCount: 0, leadDist: 999, holdActive: false },
      });

      const heads: SignalHeadMeshRef[] = [];
      const roadWidth = 14;

      // 1. Place 4 signal posts at corners
      const corners = [
        { x: node.x - roadWidth * 0.62, z: node.z - roadWidth * 0.62, axis: 'ns' as const },
        { x: node.x + roadWidth * 0.62, z: node.z - roadWidth * 0.62, axis: 'ew' as const },
        { x: node.x - roadWidth * 0.62, z: node.z + roadWidth * 0.62, axis: 'ew' as const },
        { x: node.x + roadWidth * 0.62, z: node.z + roadWidth * 0.62, axis: 'ns' as const },
      ];

      corners.forEach((c) => {
        const post = new THREE.Group();

        // Mast pole
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(c.x, 3.75, c.z);
        pole.castShadow = true;
        post.add(pole);

        // Signal Housing Box
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(c.x, 5.8, c.z);
        post.add(box);

        // 3 Lenses facing street
        const offsetZ = c.axis === 'ns' ? 0.38 : 0;
        const offsetX = c.axis === 'ew' ? 0.38 : 0;

        const redLens = new THREE.Mesh(lensGeo, redOnMat.clone());
        redLens.position.set(c.x + offsetX, 6.4, c.z + offsetZ);

        const yellowLens = new THREE.Mesh(lensGeo, lampOffMat.clone());
        yellowLens.position.set(c.x + offsetX, 5.8, c.z + offsetZ);

        const greenLens = new THREE.Mesh(lensGeo, lampOffMat.clone());
        greenLens.position.set(c.x + offsetX, 5.2, c.z + offsetZ);

        post.add(redLens, yellowLens, greenLens);
        this.group.add(post);

        heads.push({
          boxMesh: box,
          redLens,
          yellowLens,
          greenLens,
          axis: c.axis,
        });
      });

      this.signalHeads.set(nodeId, heads);

      // 2. Place 4 Physical Stop-Bars & Induction Loop Sensors on Incoming Lanes
      // Right-hand drive offset = 3.2m; Stop line offset = 7.5m before center
      const approaches = [
        // Northbound approach (entering from South, heading North -Z):
        {
          axis: 'ns' as const,
          barPos: { x: node.x + 3.2, y: 0.02, z: node.z + 7.5 },
          sensorPos: { x: node.x + 3.2, y: 0.015, z: node.z + 9.0 },
          isNS: true,
        },
        // Southbound approach (entering from North, heading South +Z):
        {
          axis: 'ns' as const,
          barPos: { x: node.x - 3.2, y: 0.02, z: node.z - 7.5 },
          sensorPos: { x: node.x - 3.2, y: 0.015, z: node.z - 9.0 },
          isNS: true,
        },
        // Eastbound approach (entering from West, heading East +X):
        {
          axis: 'ew' as const,
          barPos: { x: node.x - 7.5, y: 0.02, z: node.z + 3.2 },
          sensorPos: { x: node.x - 9.0, y: 0.015, z: node.z + 3.2 },
          isNS: false,
        },
        // Westbound approach (entering from East, heading West -X):
        {
          axis: 'ew' as const,
          barPos: { x: node.x + 7.5, y: 0.02, z: node.z - 3.2 },
          sensorPos: { x: node.x + 9.0, y: 0.015, z: node.z - 3.2 },
          isNS: false,
        },
      ];

      approaches.forEach((app) => {
        // Stop bar white road marking
        const barMesh = new THREE.Mesh(app.isNS ? stopBarGeoNS : stopBarGeoEW, stopBarWhiteMat);
        barMesh.rotation.x = -Math.PI / 2;
        barMesh.position.set(app.barPos.x, app.barPos.y, app.barPos.z);
        this.group.add(barMesh);

        // Induction loop sensor plate
        const sensorMesh = new THREE.Mesh(app.isNS ? sensorGeoNS : sensorGeoEW, sensorRedIdleMat.clone());
        sensorMesh.rotation.x = -Math.PI / 2;
        sensorMesh.position.set(app.sensorPos.x, app.sensorPos.y, app.sensorPos.z);
        this.group.add(sensorMesh);

        this.stopBarSensors.push({
          barMesh,
          sensorMesh,
          axis: app.axis,
          nodeId,
        });
      });
    });
  }

  /**
   * Resets frame occupancy sensors prior to vehicle scanning.
   */
  public beginOccupancyScan() {
    for (const data of this.activeScanOccupancy.values()) {
      data.ns.occupied = false;
      data.ns.vehicleCount = 0;
      data.ns.leadDist = 999.0;
      data.ns.holdActive = false;

      data.ew.occupied = false;
      data.ew.vehicleCount = 0;
      data.ew.leadDist = 999.0;
      data.ew.holdActive = false;
    }
  }

  /**
   * Identifies the immediate physical intersection node that the vehicle is approaching or traversing.
   */
  public findUpcomingIntersection(v: VehicleAgent): {
    nodeId: string;
    node: MapNode;
    dist: number;
    travelAxis: 'ns' | 'ew';
    isInsideBox: boolean;
  } | null {
    let bestNode: MapNode | null = null;
    let bestDist = 999.0;
    let bestAxis: 'ns' | 'ew' = 'ns';

    for (const [nodeId, node] of this.city.nodes.entries()) {
      if (!node.trafficLight) continue;
      const dx = node.x - v.x;
      const dz = node.z - v.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 38.0) continue;

      const forwardDist = Math.sin(v.heading) * dx + Math.cos(v.heading) * dz;
      const lateralDist = Math.abs(Math.cos(v.heading) * dx - Math.sin(v.heading) * dz);

      // Either inside box (dist < 8.2m) or approaching ahead in same lane corridor
      if (dist < 8.2 || (lateralDist < 8.5 && forwardDist > -2.0)) {
        if (dist < bestDist) {
          bestDist = dist;
          bestNode = node;
          bestAxis = Math.abs(dz) > Math.abs(dx) ? 'ns' : 'ew';
        }
      }
    }

    if (!bestNode) return null;
    return {
      nodeId: bestNode.id,
      node: bestNode,
      dist: bestDist,
      travelAxis: bestAxis,
      isInsideBox: bestDist < 7.5,
    };
  }

  /**
   * Evaluates vehicle approach towards upcoming intersection node and computes
   * occupancy registration, progressive deceleration curve, and full stop bar lock.
   * STRICT CLEARANCE: Vehicles inside or past the stop bar are NEVER commanded to stop!
   */
  public evaluateVehicleApproach(v: VehicleAgent): VehicleSignalResponse {
    const defaultResp: VehicleSignalResponse = {
      hasSignal: false,
      isRedOrYellow: false,
      travelAxis: 'ns',
      distToIntersection: 999,
      distToStopBar: 999,
      mustDecelerate: false,
      mustFullStop: false,
      targetDecelSpeed: v.targetSpeed,
      statusRule: 'Cruising',
    };

    const upcoming = this.findUpcomingIntersection(v);
    if (!upcoming) return defaultResp;

    const { nodeId, dist, travelAxis, isInsideBox } = upcoming;
    const isRedOrYellow = this.isSignalRedForVehicle(nodeId, travelAxis);
    const distToStopBar = dist - 7.5; // Stop line is 7.5m before intersection center

    // Register into occupancy tracking
    const occNode = this.activeScanOccupancy.get(nodeId);
    if (occNode) {
      const axisOcc = travelAxis === 'ns' ? occNode.ns : occNode.ew;
      axisOcc.vehicleCount++;
      if (dist < axisOcc.leadDist) {
        axisOcc.leadDist = dist;
      }
      if (isRedOrYellow && distToStopBar <= 2.2 && distToStopBar >= -0.5) {
        axisOcc.occupied = true;
        axisOcc.holdActive = true;
      }
    }

    // 1. INSIDE INTERSECTION BOX (dist < 7.5m or distToStopBar < -0.2m):
    // CRITICAL: Once a vehicle has entered the intersection box, it has crossed the stop bar.
    // It MUST NEVER STOP inside the intersection for red or yellow lights!
    // It is granted full clearance priority to clear out of the intersection box.
    if (isInsideBox || distToStopBar < -0.2) {
      return {
        hasSignal: true,
        isRedOrYellow: false, // Override to allow swift clearance without halting!
        travelAxis,
        distToIntersection: dist,
        distToStopBar,
        mustDecelerate: false,
        mustFullStop: false,
        targetDecelSpeed: Math.max(v.targetSpeed, 8.5),
        statusRule: 'Intersection Box Clearance: Evacuating Junction',
      };
    }

    // 2. GREEN SIGNAL: Full clearance through the intersection!
    if (!isRedOrYellow) {
      return {
        hasSignal: true,
        isRedOrYellow: false,
        travelAxis,
        distToIntersection: dist,
        distToStopBar,
        mustDecelerate: false,
        mustFullStop: false,
        targetDecelSpeed: v.maxSpeed,
        statusRule: 'Green Signal Intersection Clearance',
      };
    }

    // 3. STOP BAR OCCUPANCY & FULL STOP ZONE (distToStopBar between -0.2m and 2.2m):
    // Vehicle is right at the stop line before the intersection!
    if (distToStopBar <= 2.2 && distToStopBar >= -0.2) {
      return {
        hasSignal: true,
        isRedOrYellow: true,
        travelAxis,
        distToIntersection: dist,
        distToStopBar,
        mustDecelerate: true,
        mustFullStop: true,
        targetDecelSpeed: 0,
        statusRule: 'Red Signal Stop Bar: Full Stop Enforced',
      };
    }

    // 4. ADVANCE DECELERATION SENSOR ZONE (distToStopBar > 2.2m up to 38.0m):
    // Vehicle smoothly and progressively decelerates towards the stop bar
    if (distToStopBar > 2.2 && dist <= 38.0) {
      const decelRatio = Math.max(0, Math.min(1, (distToStopBar - 2.0) / 22.0));
      const decelSpeed = Math.max(1.0, decelRatio * 7.5);

      return {
        hasSignal: true,
        isRedOrYellow: true,
        travelAxis,
        distToIntersection: dist,
        distToStopBar,
        mustDecelerate: true,
        mustFullStop: false,
        targetDecelSpeed: decelSpeed,
        statusRule: 'Red Signal Approach: Progressive Deceleration',
      };
    }

    return {
      hasSignal: true,
      isRedOrYellow: true,
      travelAxis,
      distToIntersection: dist,
      distToStopBar,
      mustDecelerate: false,
      mustFullStop: false,
      targetDecelSpeed: v.targetSpeed,
      statusRule: 'Red Signal Advance Sensor Advisory',
    };
  }

  /**
   * Finalizes occupancy scan and syncs visual 3D induction sensor meshes on asphalt.
   */
  public endOccupancyScan() {
    this.city.nodes.forEach((node, nodeId) => {
      const occData = this.activeScanOccupancy.get(nodeId);
      if (node.trafficLight && occData) {
        node.trafficLight.nsOccupancy = { ...occData.ns };
        node.trafficLight.ewOccupancy = { ...occData.ew };
      }
    });

    // Update 3D Stop-Bar sensor induction loop meshes
    for (const sensorRef of this.stopBarSensors) {
      const node = this.city.nodes.get(sensorRef.nodeId);
      if (!node || !node.trafficLight) continue;

      const state = sensorRef.axis === 'ns' ? node.trafficLight.nsState : node.trafficLight.ewState;
      const occ = sensorRef.axis === 'ns' ? node.trafficLight.nsOccupancy : node.trafficLight.ewOccupancy;

      if (state === 'green') {
        sensorRef.sensorMesh.material = sensorGreenMat;
      } else if (state === 'yellow') {
        sensorRef.sensorMesh.material = sensorYellowMat;
      } else {
        // Red light: if vehicle is occupying the stop bar, show glowing bright active red!
        sensorRef.sensorMesh.material = occ?.occupied ? sensorRedActiveMat : sensorRedIdleMat;
      }
    }
  }

  /**
   * Main signal update cycle with strict 52.0-second periodicity
   * and emergency green-wave preemption.
   */
  /**
   * Synchronizes signal state from Python Django backend.
   */
  public syncFromBackend(trafficLights: Record<string, any>) {
    Object.entries(trafficLights).forEach(([nodeId, tlState]: [string, any]) => {
      const node = this.city.nodes.get(nodeId);
      if (!node || !node.trafficLight) return;
      const tl = node.trafficLight;
      tl.nsState = tlState.ns_state || tlState.nsState || tl.nsState;
      tl.ewState = tlState.ew_state || tlState.ewState || tl.ewState;
      if (tlState.timer !== undefined) tl.timer = tlState.timer;
      if (tlState.phase_index !== undefined) tl.phaseIndex = tlState.phase_index;
      if (tlState.phase_name !== undefined) tl.phaseName = tlState.phase_name;
      if (tlState.phase_time_remaining !== undefined) tl.phaseTimeRemaining = tlState.phase_time_remaining;

      const heads = this.signalHeads.get(nodeId);
      if (heads) {
        heads.forEach((h) => {
          const state = h.axis === 'ns' ? tl.nsState : tl.ewState;
          this.updateHeadLenses(h, state);
        });
      }
    });
  }

  public update(dt: number) {
    this.city.nodes.forEach((node, nodeId) => {
      const tl = node.trafficLight;
      if (!tl) return;

      // A. Emergency Preemption Override
      if (tl.emergencyOverrideAxis) {
        tl.emergencyOverrideTimer -= dt;

        if (tl.emergencyOverrideAxis === 'ns') {
          tl.nsState = 'green';
          tl.ewState = 'red';
          tl.phaseName = 'Emergency V2I Green-Wave Preemption (NS)';
        } else {
          tl.ewState = 'green';
          tl.nsState = 'red';
          tl.phaseName = 'Emergency V2I Green-Wave Preemption (EW)';
        }

        if (tl.emergencyOverrideTimer <= 0) {
          tl.emergencyOverrideAxis = null;
        }
      } else {
        // B. Standard 52.0-Second Strict 6-Phase Cycle
        tl.timer = (tl.timer + dt) % STRICT_CYCLE_DURATION;
        const phase = TrafficSignalManager.evaluateCyclePhase(tl.timer);

        tl.nsState = phase.nsState;
        tl.ewState = phase.ewState;
        tl.phaseIndex = phase.phaseIndex;
        tl.phaseName = phase.phaseName;
        tl.phaseTimeRemaining = phase.phaseTimeRemaining;
        tl.cycleDuration = STRICT_CYCLE_DURATION;
      }

      // C. Update 3D Signal Head Lenses
      const heads = this.signalHeads.get(nodeId);
      if (heads) {
        heads.forEach((h) => {
          const state = h.axis === 'ns' ? tl.nsState : tl.ewState;
          this.updateHeadLenses(h, state);
        });
      }
    });
  }

  private updateHeadLenses(head: SignalHeadMeshRef, state: SignalLightColor) {
    if (state === 'red') {
      head.redLens.material = redOnMat;
      head.yellowLens.material = lampOffMat;
      head.greenLens.material = lampOffMat;
    } else if (state === 'yellow') {
      head.redLens.material = lampOffMat;
      head.yellowLens.material = yellowOnMat;
      head.greenLens.material = lampOffMat;
    } else {
      head.redLens.material = lampOffMat;
      head.yellowLens.material = lampOffMat;
      head.greenLens.material = greenOnMat;
    }
  }

  /**
   * Triggers V2I Green-Wave Preemption when an emergency vehicle approaches.
   * Includes anti-thrash lock: existing preemption holds for minimum 3s before conflicting axis can steal.
   */
  public requestEmergencyPreemption(nodeId: string, axis: 'ns' | 'ew', duration = 7.0) {
    const node = this.city.nodes.get(nodeId);
    if (!node || !node.trafficLight) return;

    const currentOverride = node.trafficLight.emergencyOverrideAxis;
    if (currentOverride && currentOverride !== axis && node.trafficLight.emergencyOverrideTimer > 2.5) {
      return;
    }

    if (!node.trafficLight.emergencyOverrideAxis) {
      this.totalPreemptions++;
    }

    node.trafficLight.emergencyOverrideAxis = axis;
    node.trafficLight.emergencyOverrideTimer = duration;
  }

  /**
   * Checks whether a vehicle approaching an intersection node has a RED or YELLOW light
   */
  public isSignalRedForVehicle(
    nodeId: string,
    axisOrHeading: 'ns' | 'ew' | number
  ): boolean {
    const node = this.city.nodes.get(nodeId);
    if (!node || !node.trafficLight) return false;

    let travelAxis: 'ns' | 'ew';
    if (typeof axisOrHeading === 'string') {
      travelAxis = axisOrHeading;
    } else {
      const cosH = Math.abs(Math.cos(axisOrHeading));
      travelAxis = cosH > 0.707 ? 'ns' : 'ew';
    }

    const state = travelAxis === 'ns' ? node.trafficLight.nsState : node.trafficLight.ewState;
    return state === 'red' || state === 'yellow';
  }

  /**
   * Inspects detailed timing and occupancy telemetry for any intersection node.
   */
  public getCycleInfo(nodeId: string) {
    const node = this.city.nodes.get(nodeId);
    if (!node || !node.trafficLight) return null;

    const tl = node.trafficLight;
    return {
      nodeId,
      cycleDuration: STRICT_CYCLE_DURATION,
      timer: Number(tl.timer.toFixed(1)),
      phaseIndex: tl.phaseIndex,
      phaseName: tl.phaseName,
      phaseRemaining: tl.phaseTimeRemaining,
      nsState: tl.nsState,
      ewState: tl.ewState,
      nsOccupancy: tl.nsOccupancy,
      ewOccupancy: tl.ewOccupancy,
      emergencyOverride: tl.emergencyOverrideAxis
        ? `${tl.emergencyOverrideAxis.toUpperCase()} (${tl.emergencyOverrideTimer.toFixed(1)}s)`
        : 'None',
    };
  }
}
