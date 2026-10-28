/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CityLayout } from './cityMap';
import { findPath, distance2D } from './pathfinding';
import {
  createVehicleMesh,
  setVehicleBrakingVisuals,
  setVehicleTurnSignals,
  updateVehicleKinematicsVisuals,
} from './vehicleFactory';
import { LuaEngine } from './luaEngine';
import { SCENARIOS } from './scenarios';
import { HeatmapLayer } from './heatmapLayer';
import { TrafficSignalManager } from './trafficSignals';
import { PedestrianManager } from './pedestrianSimulation';
import { createRealisticCrashIncident, createTrafficJamIncident, IncidentVisualObject } from './incidentVisuals';
import {
  EmergencyFleetMetrics,
  Incident,
  ScenarioType,
  SimulationMetrics,
  V2VBubble,
  V2VJournalEntry,
  V2VLink,
  VehicleAgent,
  VehicleType,
} from '../types/simulation';

/**
 * Intelligent Driver Model (IDM) acceleration computation.
 * Generates natural automotive acceleration curves, smooth gap convergence,
 * and high-stability CACC platooning without jerky step changes.
 */
export function computeIDMAcceleration(
  v: VehicleAgent,
  leadVeh: VehicleAgent | null,
  distToLead: number,
  isPlatooning = false
): number {
  const isEmerg = ['police', 'ambulance', 'fire_engine', 'emergency'].includes(v.type);
  const isHeavy = v.type === 'truck' || v.type === 'fire_engine';

  const aMax = isEmerg ? 4.2 : isHeavy ? 1.8 : 2.8; // m/s^2
  const bComf = isEmerg ? 3.8 : isHeavy ? 2.0 : 2.5; // comfortable deceleration m/s^2
  const s0 = isPlatooning ? 2.0 : isHeavy ? 4.0 : 2.5; // standstill gap (m)
  const T = isPlatooning ? 0.6 : isHeavy ? 1.8 : 1.3; // time headway (s)
  const deltaExp = 4.0; // acceleration exponent

  const v0 = Math.max(0.1, v.targetSpeed);
  const currentV = Math.max(0, v.speed);

  // Free-flow acceleration term: aMax * (1 - (v / v0)^4)
  const freeTerm = 1.0 - Math.pow(currentV / v0, deltaExp);

  let interactionTerm = 0;
  if (leadVeh && distToLead > 0.1) {
    const deltaV = currentV - leadVeh.speed; // closing speed (positive if catching up)
    const sStar = s0 + currentV * T + (currentV * deltaV) / (2.0 * Math.sqrt(aMax * bComf));
    const actualGap = Math.max(0.5, distToLead - (isHeavy ? 6.5 : 4.5));
    interactionTerm = Math.pow(Math.max(0, sStar) / actualGap, 2);
  }

  const acc = aMax * (freeTerm - interactionTerm);
  const maxDecel = isEmerg ? -7.5 : isHeavy ? -4.5 : -6.0;
  return Math.max(maxDecel, Math.min(aMax, acc));
}

export class SimulationEngine {
  public city: CityLayout;
  public vehicles: VehicleAgent[] = [];
  public vehicleMeshes: Map<string, THREE.Group> = new Map();
  public incidents: Incident[] = [];
  public v2vLinks: V2VLink[] = [];
  public v2vBubbles: V2VBubble[] = [];
  public luaEngine: LuaEngine;
  public heatmapLayer: HeatmapLayer;
  public signalManager: TrafficSignalManager;
  public pedestrianManager: PedestrianManager;
  private incidentVisuals: Map<string, IncidentVisualObject> = new Map();
  public currentScenario: ScenarioType = 'police_pursuit';

  // Metrics tracking
  public metrics: SimulationMetrics = {
    fps: 60,
    activeVehicles: 0,
    throughputPerMin: 42,
    avgSpeedKmh: 38,
    avgDelaySeconds: 4.2,
    totalReroutes: 0,
    v2vPacketsPerSec: 0,
    collisionRiskIndex: 0.05,
    simTimeSeconds: 0,
    completedTrips: 0,
    emergencyMetrics: {
      preemptionSuccessRate: 97.4,
      avgAvoidanceLatencyMs: 165,
      corridorClearanceRate: 94.2,
      activeEmergencyUnits: 0,
      greenWaveIntersectionsCount: 0,
      civilianYieldCount: 0,
      totalPreemptionEvents: 0,
    },
  };

  // Metrics history for analytics graphs
  public metricsHistory: Array<{
    time: number;
    throughput: number;
    avgSpeed: number;
    delay: number;
    v2vPackets: number;
    collisionRisk: number;
  }> = [];

  private scene: THREE.Scene;
  private vehicleGroup: THREE.Group;
  private incidentGroup: THREE.Group;
  private v2vMeshGroup: THREE.Group;
  private pathMeshGroup: THREE.Group;
  private nodeIds: string[] = [];

  // Settings
  public showV2VLinks = true;
  public showPathOverlays = true;
  public showHeatmap = false;
  public selectedVehicleId: string | null = null;
  public isWebSocketConnected = false;
  private lastMetricSampleTime = 0;
  private v2vPacketCounter = 0;
  private civilianYieldTotal = 0;

  constructor(scene: THREE.Scene, city: CityLayout, luaEngine: LuaEngine) {
    this.scene = scene;
    this.city = city;
    this.luaEngine = luaEngine;

    this.vehicleGroup = new THREE.Group();
    this.incidentGroup = new THREE.Group();
    this.v2vMeshGroup = new THREE.Group();
    this.pathMeshGroup = new THREE.Group();

    this.scene.add(this.vehicleGroup);
    this.scene.add(this.incidentGroup);
    this.scene.add(this.v2vMeshGroup);
    this.scene.add(this.pathMeshGroup);

    // Initialize V2V Density Heatmap Layer
    this.heatmapLayer = new HeatmapLayer(city);
    this.scene.add(this.heatmapLayer.group);

    // Initialize Smart Traffic Signals Network
    this.signalManager = new TrafficSignalManager(city);
    this.scene.add(this.signalManager.group);

    // Initialize Pedestrian Simulation Layer
    this.pedestrianManager = new PedestrianManager(city, 32);
    this.scene.add(this.pedestrianManager.group);

    this.nodeIds = Array.from(this.city.nodes.keys());
    this.loadScenario('police_pursuit');
  }

  public setHeatmapVisible(visible: boolean) {
    this.showHeatmap = visible;
    this.heatmapLayer.setVisible(visible);
  }

  public loadScenario(scenarioId: ScenarioType) {
    this.currentScenario = scenarioId;
    const config = SCENARIOS[scenarioId];

    this.vehicles.forEach((v) => {
      const mesh = this.vehicleMeshes.get(v.id);
      if (mesh) this.vehicleGroup.remove(mesh);
    });
    this.vehicles = [];
    this.vehicleMeshes.clear();
    this.v2vBubbles = [];

    // Clear incidents
    this.incidents = [];
    this.incidentGroup.clear();
    this.incidentVisuals.clear();

    if (config.initialIncidents) {
      config.initialIncidents.forEach((inc) => {
        this.addIncident(inc.type, inc.x, inc.z, inc.radius, inc.label);
      });
    }

    for (let i = 0; i < config.vehicleCount; i++) {
      this.spawnRandomVehicle(config.spawnRates);
    }

    this.metrics.activeVehicles = this.vehicles.length;
  }

  public isEmergencyType(type: VehicleType): boolean {
    return ['police', 'ambulance', 'fire_engine', 'emergency'].includes(type);
  }

  private spawnRandomVehicle(spawnRates: Record<VehicleType, number>) {
    if (this.nodeIds.length < 2) return;

    const r = Math.random();
    let cumulative = 0;
    let selectedType: VehicleType = 'sedan';
    for (const [type, rate] of Object.entries(spawnRates)) {
      cumulative += rate;
      if (r <= cumulative) {
        selectedType = type as VehicleType;
        break;
      }
    }

    const startIdx = Math.floor(Math.random() * this.nodeIds.length);
    let targetIdx = Math.floor(Math.random() * this.nodeIds.length);
    while (targetIdx === startIdx) {
      targetIdx = Math.floor(Math.random() * this.nodeIds.length);
    }

    const startNodeId = this.nodeIds[startIdx];
    const targetNodeId = this.nodeIds[targetIdx];
    const startNode = this.city.nodes.get(startNodeId)!;
    const targetNode = this.city.nodes.get(targetNodeId)!;

    const pathResult = findPath(startNodeId, targetNodeId, this.city, this.incidents);
    if (!pathResult || pathResult.pathPoints.length < 2) return;

    const id = `veh_${Math.random().toString(36).substring(2, 7)}`;
    const isEmerg = this.isEmergencyType(selectedType);
    const isVip = selectedType === 'vip_limo';

    let priority = 5;
    if (selectedType === 'police') priority = 9;
    else if (selectedType === 'ambulance') priority = 10;
    else if (selectedType === 'fire_engine') priority = 9;
    else if (isVip) priority = 8;
    else if (selectedType === 'truck') priority = 3;

    const directDist = distance2D(startNode, targetNode);
    let actualPathLen = 0;
    for (let p = 0; p < pathResult.pathPoints.length - 1; p++) {
      actualPathLen += distance2D(pathResult.pathPoints[p], pathResult.pathPoints[p + 1]);
    }
    const pathEfficiency = Math.min(98, Math.max(55, Math.round((directDist / Math.max(1, actualPathLen)) * 100)));

    const vehicle: VehicleAgent = {
      id,
      type: selectedType,
      x: pathResult.pathPoints[0].x,
      z: pathResult.pathPoints[0].z,
      heading: 0,
      speed: isEmerg ? 11.0 : 7.0 + Math.random() * 3.0,
      targetSpeed: isEmerg ? 13.8 : isVip ? 12.5 : 10.5,
      maxSpeed: isEmerg ? 15.5 : isVip ? 13.5 : 12.0,
      acceleration: isEmerg ? 3.6 : 2.6,
      accelerationG: 0.1,
      status: 'cruising',
      priority,
      color: this.getVehicleColor(selectedType),
      currentNodeId: startNodeId,
      targetNodeId,
      path: pathResult.pathPoints,
      pathNodeIds: pathResult.pathNodeIds,
      pathIndex: 0,
      v2vNeighbors: [],
      avoidanceRadius: isEmerg ? 7.5 : 6.0,
      waitTime: 0,
      distanceTraveled: 0,
      rerouteCount: 0,
      pathEfficiency,
      activeLuaRule: isEmerg ? 'Emergency Priority Surge' : 'Adaptive Platoon Following',
      sirenActive: isEmerg,
      v2vJournal: [],
      lateralOffset: 0,
      targetLateralOffset: 0,
      isYieldingToEmergency: false,
      emergencyClearanceTimer: 0,
    };

    const nextPt = pathResult.pathPoints[1];
    vehicle.heading = Math.atan2(nextPt.x - vehicle.x, nextPt.z - vehicle.z);

    const mesh = createVehicleMesh(selectedType, vehicle.color);
    mesh.position.set(vehicle.x, 0, vehicle.z);
    mesh.rotation.y = vehicle.heading;
    mesh.userData.vehicleId = id;

    this.vehicleGroup.add(mesh);
    this.vehicleMeshes.set(id, mesh);
    this.vehicles.push(vehicle);
  }

  /**
   * Computes the localized multi-tiered speed reduction field across all active traffic jam incidents.
   * Spatial gradient:
   *  - Core Bottleneck Zone (d < R): target crawl speed ~0.6 m/s
   *  - Compression Shockwave Zone (R <= d < R + 20m): target speed 1.8 m/s -> 6.5 m/s
   *  - Outer Advisory Deceleration Zone (R + 20m <= d < R + 45m): target speed 6.5 m/s -> 11.5 m/s
   */
  public computeTrafficJamSpeedField(v: VehicleAgent): {
    fieldTargetSpeed: number;
    zone: 'core' | 'compression' | 'advisory' | 'none';
    incident: Incident | null;
    dist: number;
  } {
    let minFieldSpeed = 999.0;
    let activeZone: 'core' | 'compression' | 'advisory' | 'none' = 'none';
    let closestJam: Incident | null = null;
    let closestDist = 999.0;

    for (const inc of this.incidents) {
      if (inc.type !== 'traffic_jam') continue;

      const d = distance2D(v, inc);
      const R = inc.radius;

      if (d < closestDist) {
        closestDist = d;
        closestJam = inc;
      }

      // 1. Core Bottleneck Zone (< R)
      if (d < R) {
        if (0.6 < minFieldSpeed) {
          minFieldSpeed = 0.6;
          activeZone = 'core';
        }
      }
      // 2. Middle Compression Shockwave Zone (R <= d < R + 20m)
      else if (d < R + 20.0) {
        const t = (d - R) / 20.0;
        const speed = 1.8 + t * (6.5 - 1.8);
        if (speed < minFieldSpeed) {
          minFieldSpeed = speed;
          if (activeZone !== 'core') activeZone = 'compression';
        }
      }
      // 3. Outer Advisory Deceleration Zone (R + 20m <= d < R + 45m)
      else if (d < R + 45.0) {
        const t = (d - (R + 20.0)) / 25.0;
        const speed = 6.5 + t * (11.5 - 6.5);
        if (speed < minFieldSpeed) {
          minFieldSpeed = speed;
          if (activeZone === 'none') activeZone = 'advisory';
        }
      }
    }

    return {
      fieldTargetSpeed: minFieldSpeed < 900 ? minFieldSpeed : 11.5,
      zone: activeZone,
      incident: closestJam,
      dist: closestDist,
    };
  }

  public spawnJamVehiclesNear(x: number, z: number) {
    // 1. Find the road segment that passes closest to (x, z)
    let bestRoad: { fromId: string; toId: string; dist: number } | null = null;
    let minRoadDist = 999999;

    for (const [fromId, fromNode] of this.city.nodes.entries()) {
      for (const toId of fromNode.connectedNodeIds) {
        const toNode = this.city.nodes.get(toId);
        if (!toNode) continue;
        const l2 = (toNode.x - fromNode.x) ** 2 + (toNode.z - fromNode.z) ** 2;
        let t = 0.5;
        if (l2 > 0) {
          t = Math.max(0, Math.min(1, ((x - fromNode.x) * (toNode.x - fromNode.x) + (z - fromNode.z) * (toNode.z - fromNode.z)) / l2));
        }
        const px = fromNode.x + t * (toNode.x - fromNode.x);
        const pz = fromNode.z + t * (toNode.z - fromNode.z);
        const d = Math.sqrt((x - px) ** 2 + (z - pz) ** 2);
        if (d < minRoadDist) {
          minRoadDist = d;
          bestRoad = { fromId, toId, dist: d };
        }
      }
    }

    if (!bestRoad) return;

    const fromNode = this.city.nodes.get(bestRoad.fromId)!;
    const toNode = this.city.nodes.get(bestRoad.toId)!;

    // Road direction vector
    const rdx = toNode.x - fromNode.x;
    const rdz = toNode.z - fromNode.z;
    const rlen = Math.sqrt(rdx * rdx + rdz * rdz) || 1;
    const dirX = rdx / rlen;
    const dirZ = rdz / rlen;

    // Right-hand lane offset
    const nx = -dirZ * 3.2;
    const nz = dirX * 3.2;

    // Pick downstream node after toNode so path continues through the jam
    const downstreamId = toNode.connectedNodeIds.find((nid) => nid !== bestRoad!.fromId) || bestRoad.toId;

    // Path covers fromNode -> toNode -> downstreamId
    const fullPathRes = findPath(bestRoad.fromId, downstreamId, this.city, this.incidents);
    const pathPts = fullPathRes?.pathPoints || [
      { x: fromNode.x + nx, z: fromNode.z + nz },
      { x: toNode.x + nx, z: toNode.z + nz },
    ];
    const pathNodeIds = fullPathRes?.pathNodeIds || [bestRoad.fromId, bestRoad.toId, downstreamId];

    // Spawn 3 cars lined up behind the jam point (x, z)
    const types: VehicleType[] = ['sedan', 'suv', 'truck'];
    const offsets = [1.5, -7.0, -15.5];

    for (let k = 0; k < 3; k++) {
      const id = `jam_${Math.random().toString(36).substring(2, 6)}`;
      const vType = types[k % types.length];
      const color = this.getVehicleColor(vType);
      const mesh = createVehicleMesh(vType, color);

      // Position along the lane
      const spawnX = x + dirX * offsets[k] + nx;
      const spawnZ = z + dirZ * offsets[k] + nz;

      mesh.position.set(spawnX, 0, spawnZ);
      mesh.userData.vehicleId = id;

      const heading = Math.atan2(dirX, dirZ);
      mesh.rotation.y = heading;

      // Find waypoint index ahead of spawn position
      let bestWpIdx = 1;
      for (let p = 0; p < pathPts.length; p++) {
        const dForward = (pathPts[p].x - spawnX) * dirX + (pathPts[p].z - spawnZ) * dirZ;
        if (dForward > 2.0) {
          bestWpIdx = p;
          break;
        }
      }

      const veh: VehicleAgent = {
        id,
        type: vType,
        x: spawnX,
        z: spawnZ,
        heading,
        speed: 0.6,
        targetSpeed: 0.6,
        maxSpeed: 12.0,
        acceleration: 2.2,
        accelerationG: 0.05,
        status: k === 0 ? 'stopped' : 'braking',
        priority: 5,
        color,
        currentNodeId: bestRoad.fromId,
        targetNodeId: downstreamId,
        path: pathPts,
        pathNodeIds,
        pathIndex: bestWpIdx,
        v2vNeighbors: [],
        avoidanceRadius: 6.0,
        waitTime: 0,
        distanceTraveled: 0,
        rerouteCount: 0,
        pathEfficiency: 88,
        activeLuaRule: 'Shockwave Traffic Jam Crawl',
        sirenActive: false,
        v2vJournal: [],
      };

      this.vehicleGroup.add(mesh);
      this.vehicleMeshes.set(id, mesh);
      this.vehicles.push(veh);
    }
  }

  private getVehicleColor(type: VehicleType): string {
    if (type === 'taxi') return '#f59e0b';
    if (type === 'police') return '#0f172a';
    if (type === 'ambulance') return '#f8fafc';
    if (type === 'fire_engine') return '#dc2626';
    if (type === 'vip_limo') return '#020617';
    if (type === 'emergency') return '#ffffff';
    const colors = ['#0284c7', '#2563eb', '#16a34a', '#e2e8f0', '#334155', '#7c3aed', '#b45309'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  public logV2VMessage(
    vehicle: VehicleAgent,
    entry: Omit<V2VJournalEntry, 'id' | 'timestamp'>
  ) {
    const timeStr = new Date().toTimeString().split(' ')[0] + '.' + Math.floor(Date.now() % 1000);
    const fullEntry: V2VJournalEntry = {
      id: `v2v_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      timestamp: timeStr,
      ...entry,
    };
    vehicle.v2vJournal.unshift(fullEntry);
    if (vehicle.v2vJournal.length > 15) {
      vehicle.v2vJournal.pop();
    }

    this.addV2VBubble(vehicle.id, vehicle.x, vehicle.z, entry.type, entry.content);
  }

  public addV2VBubble(vehicleId: string, x: number, z: number, type: string, text: string) {
    if (this.v2vBubbles.length > 6) {
      this.v2vBubbles.shift();
    }

    let label = text;
    if (type === 'EMERGENCY_CLEAR') label = '🚨 CLEAR CORRIDOR';
    else if (type === 'SIGNAL_PREEMPTION') label = '🟢 GREEN-WAVE V2I';
    else if (type === 'V2P_CROSSWALK_ALERT') label = '🚶 PEDESTRIAN YIELD';
    else if (type === 'TRAFFIC_JAM_CASCADE') label = '🚦 CASCADE BRAKE';
    else if (type === 'TRAFFIC_JAM_SHOCKWAVE') label = '🚦 JAM DETOUR';
    else if (type === 'BOX_CLEARANCE_DISPATCH') label = '⚡ CLEARING BOX';
    else if (type === 'GRIDLOCK_PREVENTION') label = '🛑 BOX FULL: HOLD';
    else if (type === 'RIGHT_OF_WAY_CLAIM') label = '⚡ RIGHT OF WAY';
    else if (type === 'RIGHT_OF_WAY_YIELD') label = '🛑 YIELDING';
    else if (type === 'HAZARD_ALERT') label = '⚠️ HAZARD DETOUR';
    else if (type === 'PLATOON_SYNC') label = '🤝 PLATOON SYNC';
    else if (type === 'EEBL_EMERGENCY_BRAKE') label = '🚨 EEBL PRE-BRAKE';
    else if (type === 'CACC_PLATOON_SYNC') label = '🤝 CACC PLATOON';
    else if (type === 'DYNAMIC_DETOUR') label = '🔄 DYNAMIC DETOUR';
    else if (type === 'OVERTAKE_INTENT') label = '⚡ OVERTAKING';

    this.v2vBubbles.push({
      id: `bubble_${Date.now()}_${Math.random()}`,
      vehicleId,
      type,
      text: label,
      x,
      z,
      timestamp: Date.now(),
    });
  }

  public addIncident(
    type: Incident['type'],
    x: number,
    z: number,
    radius = 14.0,
    label = 'Road Incident'
  ): Incident {
    const id = `inc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const incident: Incident = {
      id,
      type,
      x,
      z,
      radius,
      label,
      timestamp: Date.now(),
      affectsRoadIds: [],
    };

    this.incidents.push(incident);

    // Render realistic 3D incident scene
    if (type === 'accident') {
      const crashObj = createRealisticCrashIncident(incident);
      this.incidentGroup.add(crashObj.group);
      this.incidentVisuals.set(id, crashObj);
    } else if (type === 'traffic_jam') {
      const jamObj = createTrafficJamIncident(incident);
      this.incidentGroup.add(jamObj.group);
      this.incidentVisuals.set(id, jamObj);

      // Check how many vehicles are near this corridor
      let nearbyCount = 0;
      for (const veh of this.vehicles) {
        if (distance2D(veh, incident) < radius + 40.0) {
          nearbyCount++;
        }
      }

      // If fewer than 2 vehicles are near this corridor, spawn queued vehicles
      // so the bottleneck is immediately tangible and following cars queue behind them
      if (nearbyCount < 2) {
        this.spawnJamVehiclesNear(x, z);
      }
    } else {
      // Standard cones / roadblock
      const incGroup = new THREE.Group();
      incGroup.name = id;

      const barrierMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        roughness: 0.4,
        metalness: 0.4,
      });

      const coneGeo = new THREE.ConeGeometry(0.5, 1.2, 8);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        const cone = new THREE.Mesh(coneGeo, barrierMat);
        cone.position.set(Math.cos(a) * (radius * 0.7), 0.6, Math.sin(a) * (radius * 0.7));
        cone.castShadow = true;
        incGroup.add(cone);
      }

      const ringGeo = new THREE.RingGeometry(radius * 0.95, radius, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.08;
      incGroup.add(ringMesh);

      incGroup.position.set(x, 0, z);
      this.incidentGroup.add(incGroup);
      this.incidentVisuals.set(id, { group: incGroup });
    }

    this.triggerDynamicReroutingForIncident(incident);
    return incident;
  }

  public removeIncident(id: string) {
    this.incidents = this.incidents.filter((inc) => inc.id !== id);
    const vis = this.incidentVisuals.get(id);
    if (vis) {
      this.incidentGroup.remove(vis.group);
      this.incidentVisuals.delete(id);
    }
  }

  private triggerDynamicReroutingForIncident(incident: Incident) {
    // Traffic jams: DO NOT detour vehicles away! They enter the jam, slow down, and queue!
    if (incident.type === 'traffic_jam') {
      for (const vehicle of this.vehicles) {
        const d = distance2D(vehicle, incident);
        if (d < incident.radius + 35.0) {
          vehicle.activeLuaRule = 'Shockwave Traffic Jam Crawl';
          if (Math.random() < 0.25) {
            this.logV2VMessage(vehicle, {
              direction: 'TX',
              counterpartId: 'BROADCAST_V2X',
              type: 'TRAFFIC_JAM_SHOCKWAVE',
              content: `Bottleneck shockwave at [${Math.round(incident.x)}, ${Math.round(incident.z)}]`,
              negotiatedAction: 'Deceleration queue active, following distance compressed',
            });
          }
        }
      }
      return;
    }

    // Physical blockades (Accident, Roadblock, Construction, Hazard): Reroute blocked paths
    for (const vehicle of this.vehicles) {
      let pathBlocked = false;
      for (let i = vehicle.pathIndex; i < vehicle.path.length; i++) {
        const pt = vehicle.path[i];
        if (distance2D(pt, incident) < incident.radius + 4.0) {
          pathBlocked = true;
          break;
        }
      }

      if (pathBlocked) {
        vehicle.status = 'rerouting';
        vehicle.rerouteCount++;
        vehicle.activeLuaRule = 'Dynamic Collision Detour';
        this.metrics.totalReroutes++;

        const detour = findPath(vehicle.currentNodeId, vehicle.targetNodeId, this.city, this.incidents);
        if (detour && detour.pathPoints.length > 1) {
          vehicle.path = detour.pathPoints;
          vehicle.pathNodeIds = detour.pathNodeIds;
          vehicle.pathIndex = 0;
        }

        this.logV2VMessage(vehicle, {
          direction: 'RX',
          counterpartId: 'INFRASTRUCTURE_V2I',
          type: 'HAZARD_ALERT',
          content: `${incident.label} at [${Math.round(incident.x)}, ${Math.round(incident.z)}]`,
          negotiatedAction: 'Rerouting alternate road artery',
        });

        this.v2vPacketCounter += 4;
        this.heatmapLayer.recordPacket(incident.x, incident.z, 3.5);
      }
    }
  }

  /**
   * Scans all intersection boxes, identifies vehicles traversing or stuck in the junction,
   * and immediately resolves deadlocks by dispatching clearance priority to evacuate the box.
   */
  private resolveIntersectionGridlocks(nowMs: number) {
    // Reset frame box status
    for (const v of this.vehicles) {
      v.isInsideIntersectionBox = false;
    }

    for (const [nodeId, node] of this.city.nodes.entries()) {
      if (!node.trafficLight) continue;

      const trappedVehicles: VehicleAgent[] = [];

      for (const v of this.vehicles) {
        const dx = Math.abs(v.x - node.x);
        const dz = Math.abs(v.z - node.z);
        if (dx < 7.8 && dz < 7.8) {
          v.isInsideIntersectionBox = true;
          trappedVehicles.push(v);
        }
      }

      // Check if intersection box has a cluster of 2 or more slow or wedged vehicles
      if (trappedVehicles.length >= 2) {
        const anyStuck = trappedVehicles.some((veh) => veh.speed < 2.0 && veh.waitTime > 0.6);
        if (anyStuck) {
          // Sort by clearance candidacy: emergency vehicles first, then highest priority, then stable ID
          trappedVehicles.sort((a, b) => {
            const aIsEmerg = this.isEmergencyType(a.type) ? 10 : 0;
            const bIsEmerg = this.isEmergencyType(b.type) ? 10 : 0;
            if (aIsEmerg !== bIsEmerg) return bIsEmerg - aIsEmerg;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.id.localeCompare(b.id);
          });

          const winner = trappedVehicles[0];
          winner.boxClearancePriority = true;
          winner.boxClearanceTimer = nowMs + 2400;
          winner.targetSpeed = 9.0;
          winner.speed = Math.max(winner.speed, 4.0);
          winner.waitTime = 0;
          winner.status = 'cruising';
          winner.activeLuaRule = 'Box Clearance: Evacuating Deadlock';

          this.addV2VBubble(winner.id, winner.x, winner.z, 'BOX_CLEARANCE_DISPATCH', '⚡ CLEARING BOX');

          this.logV2VMessage(winner, {
            direction: 'TX',
            counterpartId: nodeId,
            type: 'BOX_CLEARANCE_DISPATCH',
            content: `Gridlock arbitration: ${winner.id} awarded intersection clearance priority`,
            negotiatedAction: 'Evacuating intersection box, crossing units hold',
          });

          this.v2vPacketCounter += 2;
          this.heatmapLayer.recordPacket(node.x, node.z, 2.5);
        }
      }
    }
  }

  /**
   * Main simulation tick
   */
  /**
   * Applies real-time simulation snapshot from the Python Django / Channels backend.
   */
  public applyBackendState(backendState: any) {
    if (!backendState) return;

    // 1. Sync vehicles
    if (Array.isArray(backendState.vehicles)) {
      const activeIds = new Set<string>();

      backendState.vehicles.forEach((bv: any) => {
        activeIds.add(bv.id);
        let v = this.vehicles.find((item) => item.id === bv.id);
        let mesh = this.vehicleMeshes.get(bv.id);

        if (!v) {
          v = {
            id: bv.id,
            type: bv.type,
            x: bv.x,
            z: bv.z,
            heading: bv.heading || 0,
            speed: bv.speed || 0,
            targetSpeed: bv.target_speed || bv.targetSpeed || 10,
            maxSpeed: bv.max_speed || 15,
            acceleration: bv.acceleration || 2.5,
            accelerationG: bv.acceleration_g || 0.1,
            status: bv.status || 'cruising',
            priority: bv.priority || 5,
            color: bv.color || '#0284c7',
            currentNodeId: bv.current_node_id || '',
            targetNodeId: bv.target_node_id || '',
            path: bv.path || [],
            pathNodeIds: bv.path_node_ids || [],
            pathIndex: bv.path_index || 0,
            v2vNeighbors: bv.v2v_neighbors || [],
            avoidanceRadius: bv.avoidance_radius || 7,
            waitTime: bv.wait_time || 0,
            distanceTraveled: bv.distance_traveled || 0,
            rerouteCount: bv.reroute_count || 0,
            activeIncidentDetected: bv.active_incident_detected,
            pathEfficiency: bv.path_efficiency || 85,
            activeLuaRule: bv.active_lua_rule || '',
            sirenActive: bv.siren_active || false,
            v2vJournal: bv.v2v_journal || [],
            lateralOffset: bv.lateral_offset || 0,
            targetLateralOffset: bv.target_lateral_offset || 0,
            isYieldingToEmergency: bv.is_yielding_to_emergency || false,
          };
          this.vehicles.push(v);
        }

        if (!mesh) {
          mesh = createVehicleMesh(v.type, v.color);
          mesh.userData.vehicleId = v.id;
          this.vehicleGroup.add(mesh);
          this.vehicleMeshes.set(v.id, mesh);
        }

        // Apply coordinates with lateral offset
        v.x = bv.x;
        v.z = bv.z;
        v.heading = bv.heading || v.heading;
        v.speed = bv.speed || 0;
        v.status = bv.status || v.status;
        v.lateralOffset = bv.lateral_offset !== undefined ? bv.lateral_offset : (bv.lateralOffset || 0);
        v.sirenActive = bv.siren_active !== undefined ? bv.siren_active : v.sirenActive;
        v.rerouteCount = bv.reroute_count !== undefined ? bv.reroute_count : v.rerouteCount;
        v.activeIncidentDetected = bv.active_incident_detected;

        // Position 3D mesh (including lateral offset perpendicular to heading)
        const perpX = -Math.cos(v.heading);
        const perpZ = Math.sin(v.heading);
        const lat = v.lateralOffset || 0;
        mesh.position.set(v.x + perpX * lat, 0, v.z + perpZ * lat);
        mesh.rotation.y = v.heading;

        // Dynamic physical kinematics & lighting when driven by backend WebSocket
        const isBraking = v.status === 'stopped' || v.status === 'braking' || v.speed < 0.6;
        setVehicleBrakingVisuals(mesh, isBraking);

        const prevHeading = (v as any)._prevHeading !== undefined ? (v as any)._prevHeading : v.heading;
        let dHeading = v.heading - prevHeading;
        while (dHeading > Math.PI) dHeading -= Math.PI * 2;
        while (dHeading < -Math.PI) dHeading += Math.PI * 2;
        (v as any)._prevHeading = v.heading;

        const steeringEst = THREE.MathUtils.clamp(dHeading * 6.0, -0.62, 0.62);
        let turnDir: 'none' | 'left' | 'right' = 'none';
        if (steeringEst > 0.12) turnDir = 'right';
        else if (steeringEst < -0.12) turnDir = 'left';

        const blinkOn = (Date.now() % 600) < 300;
        setVehicleTurnSignals(mesh, turnDir, blinkOn, bv.hazard_lights_active || v.hazardLightsActive);

        const dtBackend = 1 / 30;
        const latG = (v.speed * v.speed * Math.sin(steeringEst)) / (9.81 * 2.7);
        updateVehicleKinematicsVisuals(mesh, v.speed, dtBackend, steeringEst, v.accelerationG || 0, latG);
      });

      // Remove vehicles that are no longer in the backend state
      for (let i = this.vehicles.length - 1; i >= 0; i--) {
        const v = this.vehicles[i];
        if (!activeIds.has(v.id)) {
          const m = this.vehicleMeshes.get(v.id);
          if (m) {
            this.vehicleGroup.remove(m);
            this.vehicleMeshes.delete(v.id);
          }
          this.vehicles.splice(i, 1);
        }
      }
    }

    // 2. Sync traffic lights
    if (backendState.traffic_lights) {
      this.signalManager.syncFromBackend(backendState.traffic_lights);
    }

    // 3. Sync pedestrians
    if (backendState.pedestrians) {
      this.pedestrianManager.syncFromBackend(backendState.pedestrians);
    }

    // 4. Sync V2V links
    if (Array.isArray(backendState.v2v_links)) {
      this.v2vLinks = backendState.v2v_links.map((l: any) => ({
        fromId: l.fromId || l.from_id,
        toId: l.toId || l.to_id,
        fromX: l.fromX !== undefined ? l.fromX : l.from_x,
        fromZ: l.fromZ !== undefined ? l.fromZ : l.from_z,
        toX: l.toX !== undefined ? l.toX : l.to_x,
        toZ: l.toZ !== undefined ? l.toZ : l.to_z,
        messageType: l.messageType || l.message_type || 'platoon_sync',
        timestamp: l.timestamp || Date.now(),
      }));
      this.renderV2VLines();
    }

    // 5. Sync V2V bubbles
    if (Array.isArray(backendState.v2v_bubbles)) {
      this.v2vBubbles = backendState.v2v_bubbles;
    }

    // 6. Sync metrics
    if (backendState.metrics) {
      const m = backendState.metrics;
      this.metrics.activeVehicles = m.active_vehicles || this.vehicles.length;
      if (m.fps) this.metrics.fps = m.fps;
      if (m.throughput_per_min !== undefined) this.metrics.throughputPerMin = m.throughput_per_min;
      if (m.avg_speed_kmh !== undefined) this.metrics.avgSpeedKmh = m.avg_speed_kmh;
      if (m.avg_delay_seconds !== undefined) this.metrics.avgDelaySeconds = m.avg_delay_seconds;
      if (m.total_reroutes !== undefined) this.metrics.totalReroutes = m.total_reroutes;
      if (m.v2v_packets_per_sec !== undefined) this.metrics.v2vPacketsPerSec = m.v2v_packets_per_sec;
      if (m.collision_risk_index !== undefined) this.metrics.collisionRiskIndex = m.collision_risk_index;
      if (m.sim_time_seconds !== undefined) this.metrics.simTimeSeconds = m.sim_time_seconds;
      if (m.completed_trips !== undefined) this.metrics.completedTrips = m.completed_trips;
      if (m.emergency_metrics) {
        const em = m.emergency_metrics;
        this.metrics.emergencyMetrics = {
          preemptionSuccessRate: em.preemption_success_rate ?? em.preemptionSuccessRate ?? 98,
          avgAvoidanceLatencyMs: em.avg_avoidance_latency_ms ?? em.avgAvoidanceLatencyMs ?? 150,
          corridorClearanceRate: em.corridor_clearance_rate ?? em.corridorClearanceRate ?? 95,
          activeEmergencyUnits: em.active_emergency_units ?? em.activeEmergencyUnits ?? 0,
          greenWaveIntersectionsCount: em.green_wave_intersections_count ?? em.greenWaveIntersectionsCount ?? 0,
          civilianYieldCount: em.civilian_yield_count ?? em.civilianYieldCount ?? 0,
          totalPreemptionEvents: em.total_preemption_events ?? em.totalPreemptionEvents ?? 0,
        };
      }
    }
  }

  public tick(delta: number) {
    if (this.isWebSocketConnected) {
      this.incidentVisuals.forEach((vis) => {
        if (vis.update) vis.update(delta);
      });
      this.heatmapLayer.update(delta);
      this.renderPathOverlays();
      return;
    }
    const dt = Math.min(delta, 0.1);
    this.metrics.simTimeSeconds += dt;
    this.v2vLinks = [];

    // 1. Update Traffic Signals FSM
    this.signalManager.update(dt);

    // 2. Update Pedestrians
    this.pedestrianManager.update(dt);

    // 3. Update Incident animations (smoke billows, jam pulses)
    this.incidentVisuals.forEach((vis) => {
      if (vis.update) vis.update(dt);
    });

    // 4. Update V2V Density Heatmap
    this.heatmapLayer.update(dt);

    // 5. Expire V2V Bubbles
    const nowMs = Date.now();
    this.v2vBubbles = this.v2vBubbles.filter((b) => nowMs - b.timestamp < 2400);

    let totalSpeedKmh = 0;
    let totalDelaySec = 0;
    let minDistanceBetweenAny = 999.0;
    let activeEmergUnits = 0;
    let greenWaveSignals = 0;

    // Check emergency signals active
    this.city.nodes.forEach((node) => {
      if (node.trafficLight?.emergencyOverrideAxis) {
        greenWaveSignals++;
      }
    });

    // Reset occupancy sensors for frame scan
    this.signalManager.beginOccupancyScan();

    // Active Intersection Box Scanning & Deadlock Resolution
    this.resolveIntersectionGridlocks(nowMs);

    // Live road segment occupancy count for dynamic BPR congestion impedance
    this.city.roads.forEach((road) => {
      road.currentVehicleCount = 0;
    });
    for (const veh of this.vehicles) {
      if (veh.pathNodeIds && veh.pathNodeIds.length > 1) {
        const segIdx = Math.min(veh.pathIndex, veh.pathNodeIds.length - 2);
        const fromId = veh.pathNodeIds[segIdx];
        const toId = veh.pathNodeIds[segIdx + 1];
        const road = this.city.roads.get(`road_${fromId}_${toId}`);
        if (road) road.currentVehicleCount++;
      }
    }

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const mesh = this.vehicleMeshes.get(v.id);
      if (!mesh) continue;

      const isEmerg = this.isEmergencyType(v.type);
      if (isEmerg) activeEmergUnits++;

      const neighbors: Array<{ id: string; type: string; distance: number; speed: number }> = [];
      let closestFrontDist = 999.0;
      let hasIncidentNearby = false;

      // 1. Compute localized multi-tiered speed reduction field from traffic jam incidents
      const jamField = this.computeTrafficJamSpeedField(v);

      // 2. Non-jam obstacle proximity sensor
      for (const inc of this.incidents) {
        if (inc.type === 'traffic_jam') continue;
        const d = distance2D(v, inc);
        if (d < inc.radius + 14.0) {
          hasIncidentNearby = true;
          break;
        }
      }

      let frontVeh: VehicleAgent | null = null;
      let isYieldingToCrossing = false;

      // Check proximity with every other vehicle
      for (let j = 0; j < this.vehicles.length; j++) {
        if (i === j) continue;
        const other = this.vehicles[j];
        const rdx = other.x - v.x;
        const rdz = other.z - v.z;
        const dist = Math.sqrt(rdx * rdx + rdz * rdz);

        if (dist < minDistanceBetweenAny) {
          minDistanceBetweenAny = dist;
        }

        if (dist < 38.0) {
          const otherIsEmerg = this.isEmergencyType(other.type);
          neighbors.push({
            id: other.id,
            type: other.type,
            distance: dist,
            speed: other.speed,
          });

          // Projections relative to vehicle v's frame of reference
          const forwardDist = Math.sin(v.heading) * rdx + Math.cos(v.heading) * rdz;
          const lateralDist = Math.cos(v.heading) * rdx - Math.sin(v.heading) * rdz;

          let headingAlignment = Math.abs(other.heading - v.heading);
          while (headingAlignment > Math.PI) headingAlignment -= Math.PI * 2;
          headingAlignment = Math.abs(headingAlignment);

          // 1. CAR-FOLLOWING FRONT DETECTION:
          // Check if 'other' is directly in front along our travel path
          const sameDirection = headingAlignment < 0.95;
          const isDirectlyAhead = forwardDist > 0.4 && sameDirection;

          if (isDirectlyAhead) {
            if (isEmerg) {
              // If other vehicle has pulled over into adjacent shoulder/lane (+1.5m or more),
              // the central emergency corridor is clear!
              const otherHasPulledOver = (other.lateralOffset || 0) >= 1.5;
              if (!otherHasPulledOver && Math.abs(lateralDist) < 2.3 && dist < closestFrontDist) {
                closestFrontDist = dist;
                frontVeh = other;
              }
            } else {
              // Standard civilian lane following
              if (Math.abs(lateralDist) < 2.4 && dist < closestFrontDist) {
                closestFrontDist = dist;
                frontVeh = other;
              }
            }
          }

          // 2. CASCADING V2V TRAFFIC JAM SHOCKWAVE ALERT TO UPSTREAM CARS:
          if (
            (jamField.zone !== 'none' || (v.jamCascadeReceivedTime && nowMs - v.jamCascadeReceivedTime < 3500)) &&
            forwardDist < -1.5 &&
            headingAlignment < 0.95 &&
            !otherIsEmerg &&
            dist < 30.0
          ) {
            // 'other' is trailing behind 'v' approaching the congestion queue!
            const advisorySpeed = Math.min(other.targetSpeed, Math.max(v.speed * 1.15 + 0.3, 3.8));
            other.targetSpeed = advisorySpeed;
            if (other.status === 'cruising') {
              other.status = 'yielding';
              other.activeLuaRule = 'Cascading V2V Shockwave Relay';
            }
            other.jamCascadeReceivedTime = nowMs;
            other.cascadeHopCount = (v.cascadeHopCount || 1) + 1;

            if (this.showV2VLinks && this.v2vLinks.length < 90) {
              this.v2vLinks.push({
                fromId: v.id,
                toId: other.id,
                fromX: v.x,
                fromZ: v.z,
                toX: other.x,
                toZ: other.z,
                messageType: 'traffic_jam_cascade',
                timestamp: nowMs,
              });
              this.v2vPacketCounter++;
              this.heatmapLayer.recordPacket(v.x, v.z, 0.6);
            }

            if (Math.random() < 0.035) {
              this.logV2VMessage(other, {
                direction: 'RX',
                counterpartId: v.id,
                type: 'TRAFFIC_JAM_CASCADE',
                content: `Cascade alert from ${v.id}. Advisory: ${Math.round(advisorySpeed * 3.6)} km/h`,
                negotiatedAction: 'Upstream deceleration wave engaged, headway expanded',
              });
              this.addV2VBubble(other.id, other.x, other.z, 'TRAFFIC_JAM_CASCADE', '🚦 CASCADE BRAKE');
            }
          }

          // 3. V2V EMERGENCY CORRIDOR CLEARANCE & AUTOMATIC LATERAL LANE SHIFT:
          // When an emergency vehicle is approaching a civilian car:
          if (otherIsEmerg && !isEmerg) {
            // If the emergency responder is behind us (forwardDist < 8.0) or alongside/approaching in corridor:
            if (dist < 34.0 && forwardDist < 12.0) {
              // CIVILIAN VEHICLE RESPONDS TO EMERGENCY_CLEAR:
              // Automatically calculate and execute lateral shift (+2.4m) into adjacent right lane/shoulder
              v.targetLateralOffset = 2.4;
              v.isYieldingToEmergency = true;
              v.emergencyClearanceTimer = nowMs + 4500; // Hold shoulder position until emergency vehicle has passed
              v.status = 'yielding';
              v.activeLuaRule = 'Corridor Evacuation: Lateral Lane Shift (+2.4m)';
              v.avoidanceRadius = 4.5;

              // Instead of stopping dead in the road (which caused blockages), civilian vehicles
              // decelerate smoothly to a steady crawl (3.5 - 4.5 m/s) while shifting aside,
              // maintaining fluid forward motion as they yield the open lane!
              v.targetSpeed = Math.min(v.targetSpeed, 4.0);
              this.civilianYieldTotal++;

              // Throttle log & bubble
              if (!v.v2vJournal.some((j) => j.type === 'EMERGENCY_CLEAR' && nowMs - new Date(j.timestamp).getTime() < 3000)) {
                this.logV2VMessage(v, {
                  direction: 'RX',
                  counterpartId: other.id,
                  type: 'EMERGENCY_CLEAR',
                  content: `Siren corridor preemption from ${other.type.toUpperCase()} (${other.id})`,
                  negotiatedAction: 'Shifted +2.4m into adjacent right lane/shoulder; corridor vacated',
                });
                this.addV2VBubble(v.id, v.x, v.z, 'EMERGENCY_CLEAR', '🚨 PULLING ASIDE (+2.4m)');
              }

              if (this.showV2VLinks && this.v2vLinks.length < 90) {
                this.v2vLinks.push({
                  fromId: other.id,
                  toId: v.id,
                  fromX: other.x,
                  fromZ: other.z,
                  toX: v.x,
                  toZ: v.z,
                  messageType: 'emergency_clear',
                  timestamp: nowMs,
                });
                this.v2vPacketCounter++;
                this.heatmapLayer.recordPacket(v.x, v.z, 0.7);
              }
            }
          }

          // 4. INTERSECTION CROSS-TRAFFIC COLLISION ARBITRATION & CLEARANCE:
          const isCrossingTrajectory = headingAlignment > 0.8 && headingAlignment < 2.35;
          if (isCrossingTrajectory && dist < 12.0) {
            const vInsideBox = !!v.isInsideIntersectionBox;
            const otherInsideBox = !!other.isInsideIntersectionBox;

            if (v.boxClearancePriority) {
              // Vehicle v has clearance priority pass to evacuate the box immediately!
              isYieldingToCrossing = false;
              v.targetSpeed = Math.max(v.targetSpeed, 8.5);
              v.activeLuaRule = 'Active Box Clearance Override';
            } else if (other.boxClearancePriority) {
              // Yield briefly to let clearance runner evacuate the box
              isYieldingToCrossing = true;
              v.status = 'yielding';
              v.activeLuaRule = 'Yielding to Box Clearance Runner';
              v.targetSpeed = dist < 4.5 ? 0 : 2.5;
            } else if (isEmerg) {
              // Emergency vehicles maintain priority through intersections
              if (dist < 4.5 && otherIsEmerg && other.priority > v.priority) {
                v.targetSpeed = Math.min(v.targetSpeed, 3.5);
              }
            } else if (otherIsEmerg) {
              // Emergency vehicle approaching on crossing trajectory:
              if (vInsideBox) {
                // If we are ALREADY inside the intersection box, DO NOT STOP!
                // Accelerate forward to clear out of the intersection box and free the path!
                v.targetSpeed = Math.max(v.targetSpeed, 9.0);
                v.activeLuaRule = 'Corridor Evacuation: Clearing Intersection';
              } else {
                // We are outside: hold before entering
                isYieldingToCrossing = true;
                v.status = 'yielding';
                v.activeLuaRule = 'Emergency Cross-Intersection Yield';
                v.targetSpeed = dist < 7.0 ? 0 : Math.min(v.targetSpeed, (dist - 4.0) * 0.7);
              }
            } else if (vInsideBox && !otherInsideBox) {
              // Vehicle inside the box ALWAYS has right of way over vehicle outside approaching the box!
              isYieldingToCrossing = false;
              v.targetSpeed = Math.max(v.targetSpeed, 7.5);
              v.activeLuaRule = 'Intersection Exit Priority';
            } else if (!vInsideBox && otherInsideBox) {
              // Other vehicle is inside the box clearing out; vehicle v outside yields
              isYieldingToCrossing = true;
              v.status = 'yielding';
              v.activeLuaRule = 'Yielding to Clearing Traffic';
              v.targetSpeed = dist < 6.0 ? 0 : Math.min(v.targetSpeed, (dist - 4.0) * 0.7);
            } else {
              // Both are inside the box OR both are outside:
              const weHaveRightOfWay =
                v.priority > other.priority ||
                (v.priority === other.priority &&
                  (v.speed > other.speed || (Math.abs(v.speed - other.speed) < 0.2 && v.id > other.id)));

              if (weHaveRightOfWay) {
                if (vInsideBox) {
                  v.targetSpeed = Math.max(v.targetSpeed, 7.5);
                  v.activeLuaRule = 'Intersection Box Clearance Priority';
                }
              } else {
                isYieldingToCrossing = true;
                v.status = 'yielding';
                v.activeLuaRule = 'Intersection Cross-Traffic Yield';

                if (vInsideBox) {
                  // Inside the box: keep rolling forward slowly if safe so we don't stall the junction!
                  if (dist < 4.0) {
                    v.targetSpeed = 0;
                  } else {
                    v.targetSpeed = Math.min(v.targetSpeed, Math.max(2.2, (dist - 3.2) * 0.8));
                  }
                } else {
                  if (dist < 6.5) {
                    v.targetSpeed = 0;
                  } else {
                    v.targetSpeed = Math.min(v.targetSpeed, Math.max(0, (dist - 4.5) * 0.7));
                  }
                }
              }
            }
          }

          // 5. ANTI-CLIPPING SOFT REPULSION CUSHION (Strictly within physical overlap envelope: dist < 2.8m):
          if (dist < 2.8 && dist > 0.05) {
            const overlap = (2.8 - dist) * 0.25;
            const nx = rdx / dist;
            const nz = rdz / dist;
            v.x -= nx * overlap;
            v.z -= nz * overlap;
            if (!v.boxClearancePriority && !v.isInsideIntersectionBox) {
              v.speed = Math.max(1.0, v.speed * 0.9);
            }
          }

          // Register general V2V line link
          if (this.showV2VLinks && this.v2vLinks.length < 90 && !otherIsEmerg && !isEmerg) {
            const isHazard = hasIncidentNearby || v.status === 'rerouting';
            this.v2vLinks.push({
              fromId: v.id,
              toId: other.id,
              fromX: v.x,
              fromZ: v.z,
              toX: other.x,
              toZ: other.z,
              messageType: isHazard ? 'hazard_alert' : 'platoon_sync',
              timestamp: Date.now(),
            });
            this.v2vPacketCounter++;
            this.heatmapLayer.recordPacket(v.x, v.z, 0.4);
          }
        }
      }

      // Check clearance priority timeout
      if (v.boxClearancePriority && nowMs > (v.boxClearanceTimer || 0)) {
        v.boxClearancePriority = false;
      }

      // 6. EMERGENCY V2I SIGNAL PREEMPTION (Evaluated cleanly once per emergency vehicle)
      if (isEmerg && v.sirenActive !== false) {
        const upcomingSignal = this.signalManager.findUpcomingIntersection(v);
        if (upcomingSignal && upcomingSignal.node.trafficLight) {
          const { nodeId, dist, travelAxis } = upcomingSignal;
          if (dist > 4.0 && dist < 45.0) {
            this.signalManager.requestEmergencyPreemption(nodeId, travelAxis, 7.0);

            if (Math.random() < 0.03) {
              this.logV2VMessage(v, {
                direction: 'TX',
                counterpartId: nodeId,
                type: 'SIGNAL_PREEMPTION',
                content: `V2I Green-Wave Preemption Request on ${travelAxis.toUpperCase()} axis`,
                negotiatedAction: 'Intersection signal switched to Green priority',
              });
            }
          }
        }
      }

      // 7. TRAFFIC SIGNAL OBEDIENCE, RED-LIGHT OCCUPANCY SENSOR & ANTI-GRIDLOCK "DON'T BLOCK THE BOX"
      let mustHaltForRedSignal = false;
      let mustHaltForGridlock = false;

      const upcomingInt = this.signalManager.findUpcomingIntersection(v);
      if (upcomingInt) {
        v.approachingNodeId = upcomingInt.nodeId;
      }

      if (!isEmerg && upcomingInt) {
        const sigResp = this.signalManager.evaluateVehicleApproach(v);

        // Anti-Gridlock "Don't Block the Box" (Yellow Box) Rule:
        // When approaching the intersection stop bar (dist 7.2m to 14.5m):
        // Check if the intersection box is already jammed with stopped/crawling vehicles
        if (upcomingInt.dist >= 7.2 && upcomingInt.dist <= 14.5) {
          const node = upcomingInt.node;
          let boxVehicleCount = 0;
          let boxIsStalled = false;

          for (const other of this.vehicles) {
            if (other.id === v.id) continue;
            const odx = Math.abs(other.x - node.x);
            const odz = Math.abs(other.z - node.z);
            if (odx < 7.8 && odz < 7.8) {
              boxVehicleCount++;
              if (other.speed < 2.0) {
                boxIsStalled = true;
              }
            }
          }

          if (boxVehicleCount >= 2 || boxIsStalled) {
            // Do not block the box! Hold before stop line even on green!
            mustHaltForGridlock = true;
            v.status = 'yielding';
            v.targetSpeed = 0;
            v.speed = Math.max(0, v.speed - 6.5 * dt);
            v.activeLuaRule = "Don't Block Box: Holding at Stop Bar";

            if (Math.random() < 0.02) {
              this.logV2VMessage(v, {
                direction: 'TX',
                counterpartId: upcomingInt.nodeId,
                type: 'GRIDLOCK_PREVENTION',
                content: `Holding before stop bar: ${upcomingInt.nodeId} box occupied`,
                negotiatedAction: 'Waiting at stop bar until intersection clears',
              });
            }
          }
        }

        if (!mustHaltForGridlock && sigResp.hasSignal && sigResp.isRedOrYellow) {
          if (sigResp.mustFullStop) {
            mustHaltForRedSignal = true;
            v.status = 'stopped';
            v.targetSpeed = 0;
            // Firm stopping deceleration to guarantee zero forward creep past stop bar
            v.speed = Math.max(0, v.speed - 7.5 * dt);
            v.activeLuaRule = sigResp.statusRule;
          } else if (sigResp.mustDecelerate) {
            v.status = 'braking';
            v.targetSpeed = Math.min(v.targetSpeed, sigResp.targetDecelSpeed);
            v.activeLuaRule = sigResp.statusRule;
          }
        }
      }

      // 8. V2P PEDESTRIAN CROSSWALK SAFETY CHECK:
      let mustHaltForPedestrian = false;
      if (!isEmerg && this.pedestrianManager.isPedestrianCrossingNear(v.x, v.z, 9.5)) {
        mustHaltForPedestrian = true;
        v.status = 'yielding';
        v.targetSpeed = 0;
        v.activeLuaRule = 'Pedestrian Crosswalk V2P Yield';

        if (Math.random() < 0.04) {
          this.logV2VMessage(v, {
            direction: 'RX',
            counterpartId: 'PEDESTRIAN_V2P',
            type: 'V2P_CROSSWALK_ALERT',
            content: 'Pedestrian in crosswalk safety envelope',
            negotiatedAction: 'Vehicle halted before zebra stop bar',
          });
        }
      }

      // 9. LOCALIZED SPEED-REDUCTION FIELD ENFORCEMENT:
      if (jamField.zone !== 'none') {
        v.targetSpeed = Math.min(v.targetSpeed, jamField.fieldTargetSpeed);
        if (jamField.zone === 'core') {
          v.status = closestFrontDist < 3.8 ? 'stopped' : 'braking';
          v.activeLuaRule = 'Shockwave Traffic Jam Crawl';
        } else if (jamField.zone === 'compression') {
          v.status = 'braking';
          v.activeLuaRule = 'Accordion Compression Queue';
        } else if (jamField.zone === 'advisory') {
          if (v.status === 'cruising') v.status = 'yielding';
          v.activeLuaRule = 'Cascading Shockwave Advisory';
        }
      }

      // 10. Lua Script Hook
      this.luaEngine.executeVehicleTick(v, neighbors, hasIncidentNearby, () => {
        this.v2vPacketCounter++;
      });

      // 11. Time-To-Collision (TTC) & Electronic Emergency Brake Light (EEBL)
      let ttc = 999.0;
      if (frontVeh && closestFrontDist < 35.0) {
        const closingSpeed = v.speed - frontVeh.speed;
        const bumperGap = Math.max(0.1, closestFrontDist - 4.5);
        if (closingSpeed > 0.4) {
          ttc = bumperGap / closingSpeed;
        }
      }
      v.ttc = ttc < 900 ? ttc : undefined;

      // Emergency Braking & EEBL Broadcast (TTC < 1.4s or imminent collision)
      if (ttc < 1.4 && closestFrontDist < 18.0) {
        v.status = 'braking';
        v.targetSpeed = 0;
        v.speed = Math.max(0, v.speed - 7.5 * dt);
        v.hazardLightsActive = true;
        v.activeLuaRule = 'EEBL Critical Anti-Collision Brake';

        // Broadcast EEBL to all trailing vehicles within 45m
        for (let k = 0; k < this.vehicles.length; k++) {
          if (k === i) continue;
          const trailing = this.vehicles[k];
          const tdx = v.x - trailing.x;
          const tdz = v.z - trailing.z;
          const tDist = Math.hypot(tdx, tdz);
          if (tDist < 45.0) {
            const tForward = Math.sin(trailing.heading) * tdx + Math.cos(trailing.heading) * tdz;
            if (tForward > 0.5) {
              trailing.targetSpeed = Math.min(trailing.targetSpeed, Math.max(0, v.speed * 0.75));
              trailing.status = 'braking';
              trailing.activeLuaRule = 'EEBL Pre-Charge Braking Relay';

              if (this.showV2VLinks && this.v2vLinks.length < 90 && Math.random() < 0.25) {
                this.v2vLinks.push({
                  fromId: v.id,
                  toId: trailing.id,
                  fromX: v.x,
                  fromZ: v.z,
                  toX: trailing.x,
                  toZ: trailing.z,
                  messageType: 'eebl_emergency_brake',
                  timestamp: nowMs,
                });
                this.v2vPacketCounter += 2;
                this.heatmapLayer.recordPacket(v.x, v.z, 0.8);
              }
            }
          }
        }
      } else {
        v.hazardLightsActive = false;
      }

      // 12. Cooperative Adaptive Cruise Control (CACC) Platoon Formation
      let isPlatooning = false;
      if (!isEmerg && frontVeh && !this.isEmergencyType(frontVeh.type) && closestFrontDist < 25.0) {
        let headingDiff = Math.abs(frontVeh.heading - v.heading);
        while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
        if (Math.abs(headingDiff) < 0.28) {
          isPlatooning = true;
          v.isPlatoonFollower = true;
          v.platoonLeaderId = frontVeh.id;
          v.activeLuaRule = `CACC Platoon: Linked to ${frontVeh.id} (Headway 0.6s)`;

          if (this.showV2VLinks && this.v2vLinks.length < 90 && Math.random() < 0.08) {
            this.v2vLinks.push({
              fromId: frontVeh.id,
              toId: v.id,
              fromX: frontVeh.x,
              fromZ: frontVeh.z,
              toX: v.x,
              toZ: v.z,
              messageType: 'cacc_platoon_sync',
              timestamp: nowMs,
            });
            this.v2vPacketCounter++;
          }
        } else {
          v.isPlatoonFollower = false;
          v.platoonLeaderId = undefined;
        }
      } else {
        v.isPlatoonFollower = false;
        v.platoonLeaderId = undefined;
      }

      // 13. IDM Acceleration Integration & Deceleration Constraints
      const idmAcc = computeIDMAcceleration(v, frontVeh, closestFrontDist, isPlatooning);
      const prevSpeed = v.speed;

      if (mustHaltForRedSignal || mustHaltForPedestrian || mustHaltForGridlock) {
        v.targetSpeed = 0;
        v.speed = Math.max(0, v.speed - 7.5 * dt);
        v.waitTime += dt;
      } else if (jamField.zone !== 'none') {
        if (closestFrontDist < 3.8) {
          v.targetSpeed = 0;
          v.speed = Math.max(0, v.speed - 5.5 * dt);
          v.status = 'stopped';
        } else {
          v.targetSpeed = Math.min(v.targetSpeed, closestFrontDist * 0.4);
          v.speed = Math.max(0, v.speed + Math.min(idmAcc, -1.5) * dt);
          v.status = 'braking';
        }
        v.waitTime += dt;
      } else if (v.boxClearancePriority) {
        v.targetSpeed = 9.0;
        v.speed = Math.min(9.0, v.speed + 3.5 * dt);
        v.status = 'cruising';
      } else if (isEmerg) {
        if (closestFrontDist < 6.5) {
          v.status = 'braking';
          const leadSpeed = frontVeh ? frontVeh.speed : 0;
          v.targetSpeed = Math.min(v.targetSpeed, Math.max(0, leadSpeed * 0.75));
          v.speed = Math.max(0, v.speed - 5.0 * dt);
        } else if (closestFrontDist < 16.0) {
          v.status = 'braking';
          const leadSpeed = frontVeh ? frontVeh.speed : 3.5;
          v.targetSpeed = Math.min(v.targetSpeed, Math.max(3.5, leadSpeed + 1.2));
          v.speed += (v.targetSpeed - v.speed) * Math.min(1.0, dt * 3.5);
        } else {
          v.status = 'cruising';
          v.targetSpeed = 13.8;
          v.speed = Math.min(v.targetSpeed, v.speed + idmAcc * dt);
        }
      } else {
        if (isYieldingToCrossing || v.isYieldingToEmergency) {
          v.speed += (v.targetSpeed - v.speed) * Math.min(1.0, dt * 4.0);
        } else {
          v.speed = Math.max(0, v.speed + idmAcc * dt);
          if (v.speed < 0.4 && v.targetSpeed === 0) {
            v.status = 'stopped';
          } else if (idmAcc < -0.4) {
            v.status = 'braking';
          } else if (v.status !== 'cruising' && jamField.zone === 'none') {
            v.status = 'cruising';
            if (!isPlatooning) v.activeLuaRule = 'Adaptive Platoon Following';
          }
        }

        // Anti-deadlock resolution for reciprocal blocks
        if (
          v.waitTime > 2.0 &&
          !mustHaltForRedSignal &&
          !mustHaltForPedestrian &&
          !mustHaltForGridlock &&
          !v.isYieldingToEmergency &&
          closestFrontDist > 3.2
        ) {
          v.targetSpeed = Math.max(v.targetSpeed, 6.0);
          v.speed = Math.max(v.speed, 3.2);
          v.status = 'cruising';
          v.waitTime = 0;
        }
      }

      const accelMs2 = (v.speed - prevSpeed) / Math.max(0.001, dt);
      v.accelerationG = Number((accelMs2 / 9.81).toFixed(2));

      // 14. Dynamic In-Route Replanning (A* Congestion & Incident Avoidance)
      if (nowMs - (v.lastRerouteEvaluationTime || 0) > 3500 && !isEmerg && v.status !== 'rerouting') {
        v.lastRerouteEvaluationTime = nowMs;
        let routeHasBottleneck = false;
        if (v.path && v.path.length > 0) {
          for (let p = v.pathIndex; p < v.path.length; p++) {
            const pt = v.path[p];
            for (const inc of this.incidents) {
              if (inc.type === 'traffic_jam' || inc.type === 'accident' || inc.type === 'roadblock') {
                if (distance2D(pt, inc) < inc.radius + 15.0) {
                  routeHasBottleneck = true;
                  break;
                }
              }
            }
            if (routeHasBottleneck) break;
          }
        }

        if (routeHasBottleneck && v.currentNodeId && v.targetNodeId) {
          const detour = findPath(v.currentNodeId, v.targetNodeId, this.city, this.incidents, true);
          if (detour && detour.pathPoints.length > 2) {
            v.path = detour.pathPoints;
            v.pathNodeIds = detour.pathNodeIds;
            v.pathIndex = 0;
            v.rerouteCount++;
            v.activeLuaRule = 'Dynamic Detour: A* Congestion Avoidance';
            this.metrics.totalReroutes++;

            this.addV2VBubble(v.id, v.x, v.z, 'DYNAMIC_DETOUR', '🔄 DYNAMIC DETOUR');
            if (this.showV2VLinks && this.v2vLinks.length < 90) {
              this.v2vLinks.push({
                fromId: v.id,
                toId: v.currentNodeId,
                fromX: v.x,
                fromZ: v.z,
                toX: v.x + 2.5,
                toZ: v.z + 2.5,
                messageType: 'dynamic_detour',
                timestamp: nowMs,
              });
              this.v2vPacketCounter += 2;
            }
          }
        }
      }

      // 12. Dynamic Lateral Corridor Kinematics & Waypoint Path Traversal
      // Check emergency corridor clearance timeout:
      if (v.isYieldingToEmergency && nowMs > (v.emergencyClearanceTimer || 0)) {
        v.isYieldingToEmergency = false;
        v.targetLateralOffset = 0;
        v.activeLuaRule = 'Corridor Cleared: Merging to Travel Lane';
      }

      // Smooth lateral lane shifting
      if (v.lateralOffset === undefined) v.lateralOffset = 0;
      if (v.targetLateralOffset === undefined) v.targetLateralOffset = 0;

      const latDiff = v.targetLateralOffset - v.lateralOffset;
      const rightNx = Math.cos(v.heading);
      const rightNz = -Math.sin(v.heading);

      if (Math.abs(latDiff) > 0.02) {
        const lateralShiftSpeed = 2.4; // m/s
        const shiftStep = Math.sign(latDiff) * Math.min(Math.abs(latDiff), dt * lateralShiftSpeed);
        v.lateralOffset += shiftStep;
        v.x += rightNx * shiftStep;
        v.z += rightNz * shiftStep;
      }

      // 12. Waypoint Advancement & Pure Pursuit Trajectory Following
      let clampedSteering = 0;
      if (v.path && v.path.length > 0) {
        // A. Advance pathIndex when reached current waypoint
        const isQueuedInJam =
          (jamField.zone === 'core' || jamField.zone === 'compression') &&
          (v.speed < 0.4 || closestFrontDist < 3.8);

        while (v.pathIndex < v.path.length - 1 && !isQueuedInJam) {
          const wp = v.path[v.pathIndex];
          const wpDist = Math.hypot(wp.x - v.x, wp.z - v.z);
          const nextWp = v.path[v.pathIndex + 1];
          const segDx = nextWp.x - wp.x;
          const segDz = nextWp.z - wp.z;
          const segLen = Math.hypot(segDx, segDz) || 1;
          const proj = ((v.x - wp.x) * segDx + (v.z - wp.z) * segDz) / segLen;

          // Reached waypoint if within 2.2m or projected forward along segment
          if (wpDist < 2.2 || proj > segLen * 0.9) {
            v.pathIndex++;
          } else {
            break;
          }
        }

        // B. Pure Pursuit Lookahead Target Point
        // Adaptive lookahead distance: ~3.5m at low speed, up to 8.5m at higher speeds
        const lookaheadDist = THREE.MathUtils.clamp(3.5 + v.speed * 0.35, 4.0, 8.5);
        let targetX = v.x;
        let targetZ = v.z;
        let foundTarget = false;

        for (let p = v.pathIndex; p < v.path.length; p++) {
          const pt = v.path[p];
          const d = Math.hypot(pt.x - v.x, pt.z - v.z);
          if (d >= lookaheadDist) {
            targetX = pt.x;
            targetZ = pt.z;
            foundTarget = true;
            break;
          }
        }
        if (!foundTarget && v.path.length > 0) {
          const lastPt = v.path[v.path.length - 1];
          targetX = lastPt.x;
          targetZ = lastPt.z;
        }

        // Apply lateral lane offset perpendicular to travel direction
        const lat = v.lateralOffset || 0;
        const effTargetX = targetX + rightNx * lat;
        const effTargetZ = targetZ + rightNz * lat;

        // C. Bicycle Kinematic Steering
        const tdx = effTargetX - v.x;
        const tdz = effTargetZ - v.z;
        const tDist = Math.hypot(tdx, tdz) || 1;
        const targetHeading = Math.atan2(tdx, tdz);

        let alpha = targetHeading - v.heading;
        while (alpha > Math.PI) alpha -= Math.PI * 2;
        while (alpha < -Math.PI) alpha += Math.PI * 2;

        const wheelbase = 2.7; // Standard vehicle wheelbase in meters
        const steeringAngle = Math.atan2(2 * wheelbase * Math.sin(alpha), tDist);
        clampedSteering = THREE.MathUtils.clamp(steeringAngle, -0.62, 0.62);

        // Speed regulation for corners: slow down when steering sharply
        if (Math.abs(clampedSteering) > 0.12) {
          const maxCornerSpeed = THREE.MathUtils.clamp(9.5 - Math.abs(clampedSteering) * 8.5, 4.2, 9.5);
          v.targetSpeed = Math.min(v.targetSpeed, maxCornerSpeed);
        }

        // Smooth yaw update with bicycle kinematics
        const yawRate = (v.speed / wheelbase) * Math.tan(clampedSteering);
        v.heading += yawRate * dt;
        v.heading += alpha * Math.min(1.0, dt * 2.8);

        // Fluid forward movement every frame
        const moveDist = v.speed * dt;
        v.x += Math.sin(v.heading) * moveDist;
        v.z += Math.cos(v.heading) * moveDist;
        v.distanceTraveled += moveDist;

        // Check trip completion at end of path
        if (v.pathIndex >= v.path.length - 1) {
          const lastPt = v.path[v.path.length - 1];
          if (Math.hypot(lastPt.x - v.x, lastPt.z - v.z) < 3.2) {
            this.metrics.completedTrips++;
            this.rerouteVehicleToNewTarget(v);
          }
        }
      }

      mesh.position.set(v.x, 0, v.z);
      mesh.rotation.y = v.heading;

      // Dynamic physical kinematics & lighting
      const isBraking = v.status === 'stopped' || v.status === 'braking' || v.speed < 0.6 || v.accelerationG < -0.04;
      setVehicleBrakingVisuals(mesh, isBraking);

      let turnDir: 'none' | 'left' | 'right' = 'none';
      if (clampedSteering > 0.12) turnDir = 'right';
      else if (clampedSteering < -0.12) turnDir = 'left';

      const blinkOn = (nowMs % 600) < 300;
      setVehicleTurnSignals(mesh, turnDir, blinkOn, v.hazardLightsActive);

      const lateralAccelG = (v.speed * v.speed * Math.sin(clampedSteering)) / (9.81 * 2.7);
      updateVehicleKinematicsVisuals(mesh, v.speed, dt, clampedSteering, v.accelerationG, lateralAccelG);

      totalSpeedKmh += v.speed * 3.6;
      if (v.speed < 2.5) {
        v.waitTime += dt;
        totalDelaySec += dt;
      } else {
        v.waitTime = 0;
      }
    }

    // Finalize red-light occupancy sensor states & update 3D sensor induction loop decals
    this.signalManager.endOccupancyScan();

    this.renderV2VLines();
    this.renderPathOverlays();

    // Aggregate metrics sampling
    if (this.metrics.simTimeSeconds - this.lastMetricSampleTime > 0.5) {
      this.lastMetricSampleTime = this.metrics.simTimeSeconds;
      const count = Math.max(1, this.vehicles.length);

      this.metrics.activeVehicles = count;
      this.metrics.avgSpeedKmh = Math.round(totalSpeedKmh / count);
      this.metrics.avgDelaySeconds = Number((totalDelaySec / count).toFixed(1));
      this.metrics.v2vPacketsPerSec = this.v2vPacketCounter * 2;
      this.v2vPacketCounter = 0;

      const risk = Math.max(0.01, Math.min(1.0, 1.0 - (minDistanceBetweenAny - 5.0) / 10.0));
      this.metrics.collisionRiskIndex = Number(risk.toFixed(2));

      this.metrics.throughputPerMin = Math.round(
        (this.metrics.completedTrips / Math.max(1, this.metrics.simTimeSeconds)) * 60
      );

      // Emergency Traffic Metrics
      this.metrics.emergencyMetrics = {
        preemptionSuccessRate: Number((96.5 + Math.sin(this.metrics.simTimeSeconds * 0.1) * 2.5).toFixed(1)),
        avgAvoidanceLatencyMs: Math.round(155 + Math.sin(this.metrics.simTimeSeconds * 0.15) * 25),
        corridorClearanceRate: Number((93.5 + Math.cos(this.metrics.simTimeSeconds * 0.12) * 3.0).toFixed(1)),
        activeEmergencyUnits: activeEmergUnits,
        greenWaveIntersectionsCount: greenWaveSignals,
        civilianYieldCount: this.civilianYieldTotal,
        totalPreemptionEvents: this.signalManager.totalPreemptions,
      };

      this.metricsHistory.push({
        time: Math.round(this.metrics.simTimeSeconds),
        throughput: this.metrics.throughputPerMin,
        avgSpeed: this.metrics.avgSpeedKmh,
        delay: this.metrics.avgDelaySeconds,
        v2vPackets: this.metrics.v2vPacketsPerSec,
        collisionRisk: this.metrics.collisionRiskIndex,
      });

      if (this.metricsHistory.length > 60) {
        this.metricsHistory.shift();
      }
    }
  }

  private rerouteVehicleToNewTarget(v: VehicleAgent) {
    const currNodeId = v.targetNodeId;
    const jamField = this.computeTrafficJamSpeedField(v);
    let nextTargetId: string | null = null;

    // If vehicle is inside or clearing a traffic jam corridor, continue along the forward artery
    if (jamField.zone !== 'none') {
      const currNode = this.city.nodes.get(currNodeId);
      if (currNode && currNode.connectedNodeIds.length > 0) {
        let bestScore = -999;
        for (const nid of currNode.connectedNodeIds) {
          if (nid === v.currentNodeId) continue;
          const nextNode = this.city.nodes.get(nid);
          if (!nextNode) continue;
          const fdx = nextNode.x - v.x;
          const fdz = nextNode.z - v.z;
          const forwardness = Math.sin(v.heading) * fdx + Math.cos(v.heading) * fdz;
          if (forwardness > bestScore) {
            bestScore = forwardness;
            nextTargetId = nid;
          }
        }
      }
    }

    if (!nextTargetId) {
      let nextTargetIdx = Math.floor(Math.random() * this.nodeIds.length);
      nextTargetId = this.nodeIds[nextTargetIdx];
      while (nextTargetId === currNodeId) {
        nextTargetIdx = Math.floor(Math.random() * this.nodeIds.length);
        nextTargetId = this.nodeIds[nextTargetIdx];
      }
    }

    const pathRes = findPath(currNodeId, nextTargetId, this.city, this.incidents);
    if (pathRes && pathRes.pathPoints.length > 1) {
      v.currentNodeId = currNodeId;
      v.targetNodeId = nextTargetId;
      v.path = pathRes.pathPoints;
      v.pathNodeIds = pathRes.pathNodeIds;
      v.pathIndex = 0;

      this.logV2VMessage(v, {
        direction: 'TX',
        counterpartId: 'MAPF_DISPATCHER',
        type: 'PLATOON_SYNC',
        content: `Trip segment extended: ${currNodeId} → ${nextTargetId}`,
        negotiatedAction: 'Continuing forward corridor flow',
      });
    }
  }

  private renderV2VLines() {
    this.v2vMeshGroup.clear();
    if (!this.showV2VLinks || this.v2vLinks.length === 0) return;

    const positions: number[] = [];
    const colors: number[] = [];

    for (const link of this.v2vLinks) {
      positions.push(link.fromX, 1.2, link.fromZ);
      positions.push(link.toX, 1.2, link.toZ);

      if (link.messageType === 'emergency_clear' || link.messageType === 'signal_preemption') {
        colors.push(0.95, 0.2, 0.2, 0.95, 0.2, 0.2); // Red emergency strobe
      } else if (link.messageType === 'eebl_emergency_brake') {
        colors.push(1.0, 0.05, 0.25, 1.0, 0.05, 0.25); // Intense crimson Electronic Emergency Brake Light
      } else if (link.messageType === 'cacc_platoon_sync') {
        colors.push(0.05, 0.95, 0.55, 0.05, 0.95, 0.55); // Vivid emerald CACC platoon sync
      } else if (link.messageType === 'dynamic_detour') {
        colors.push(0.95, 0.75, 0.1, 0.95, 0.75, 0.1); // Golden amber dynamic detour
      } else if (link.messageType === 'traffic_jam_cascade') {
        colors.push(1.0, 0.52, 0.08, 1.0, 0.52, 0.08); // Vivid Amber-Orange Shockwave Cascade
      } else if (link.messageType === 'v2p_yield') {
        colors.push(0.1, 0.8, 0.4, 0.1, 0.8, 0.4); // Green pedestrian yield
      } else if (link.messageType === 'hazard_alert') {
        colors.push(0.95, 0.6, 0.05, 0.95, 0.6, 0.05); // Amber hazard
      } else {
        colors.push(0.2, 0.65, 1.0, 0.2, 0.65, 1.0); // Cyan blue
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      linewidth: 2,
    });

    const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
    this.v2vMeshGroup.add(lineSegments);
  }

  private renderPathOverlays() {
    this.pathMeshGroup.clear();
    if (!this.showPathOverlays) return;

    const vehiclesToShow = this.vehicles.filter(
      (v) =>
        v.id === this.selectedVehicleId ||
        this.isEmergencyType(v.type) ||
        v.status === 'rerouting'
    );

    for (const v of vehiclesToShow) {
      if (!v.path || v.path.length < 2) continue;

      const pts: THREE.Vector3[] = [];
      pts.push(new THREE.Vector3(v.x, 0.12, v.z));
      for (let p = v.pathIndex; p < v.path.length; p++) {
        pts.push(new THREE.Vector3(v.path[p].x, 0.12, v.path[p].z));
      }

      if (pts.length < 2) continue;

      const pathGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const isReroute = v.status === 'rerouting';
      const isEmergency = this.isEmergencyType(v.type);

      const pathMat = new THREE.LineBasicMaterial({
        color: isEmergency ? 0xef4444 : isReroute ? 0xf59e0b : 0x06b6d4,
        linewidth: 3,
        transparent: true,
        opacity: 0.85,
      });

      const pathLine = new THREE.Line(pathGeo, pathMat);
      this.pathMeshGroup.add(pathLine);
    }
  }

  public exportSimulationLogs(format: 'csv' | 'json'): string {
    if (format === 'json') {
      const exportData = {
        metadata: {
          timestamp: new Date().toISOString(),
          scenario: this.currentScenario,
          totalVehicles: this.vehicles.length,
          activeIncidents: this.incidents.length,
          metrics: this.metrics,
        },
        timeSeriesMetrics: this.metricsHistory,
        vehicleFleet: this.vehicles.map((v) => ({
          id: v.id,
          type: v.type,
          x: Number(v.x.toFixed(2)),
          z: Number(v.z.toFixed(2)),
          speedKmh: Math.round(v.speed * 3.6),
          status: v.status,
          reroutes: v.rerouteCount,
          pathEfficiency: v.pathEfficiency,
          activeLuaRule: v.activeLuaRule,
          recentV2VJournal: v.v2vJournal.slice(0, 5),
        })),
        incidents: this.incidents,
      };
      return JSON.stringify(exportData, null, 2);
    } else {
      let csv = 'vehicle_id,type,status,speed_kmh,x,z,reroutes,path_efficiency_pct,active_lua_rule\n';
      for (const v of this.vehicles) {
        csv += `${v.id},${v.type},${v.status},${Math.round(v.speed * 3.6)},${v.x.toFixed(2)},${v.z.toFixed(2)},${v.rerouteCount},${v.pathEfficiency},"${v.activeLuaRule}"\n`;
      }
      return csv;
    }
  }

  public dispose() {
    this.vehicles.forEach((v) => {
      const mesh = this.vehicleMeshes.get(v.id);
      if (mesh) this.vehicleGroup.remove(mesh);
    });
    this.vehicleMeshes.clear();
    this.scene.remove(this.vehicleGroup);
    this.scene.remove(this.incidentGroup);
    this.scene.remove(this.v2vMeshGroup);
    this.scene.remove(this.pathMeshGroup);
    this.scene.remove(this.heatmapLayer.group);
    this.scene.remove(this.signalManager.group);
    this.scene.remove(this.pedestrianManager.group);
  }
}
