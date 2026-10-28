/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type VehicleType =
  | 'sedan'
  | 'suv'
  | 'truck'
  | 'taxi'
  | 'emergency'
  | 'police'
  | 'ambulance'
  | 'fire_engine'
  | 'vip_limo';

export type VehicleStatus = 'cruising' | 'braking' | 'rerouting' | 'yielding' | 'stopped';

export interface Vector2D {
  x: number;
  z: number;
}

export type SignalLightColor = 'green' | 'yellow' | 'red';

export interface OccupancySensorState {
  occupied: boolean;
  vehicleCount: number;
  leadDist: number;
  holdActive: boolean;
}

export interface IntersectionTrafficLight {
  nsState: SignalLightColor;
  ewState: SignalLightColor;
  timer: number;
  cycleDuration: number; // Strictly 52.0 seconds
  phaseIndex: number; // 1 to 6
  phaseName: string;
  phaseTimeRemaining: number;
  emergencyOverrideAxis: 'ns' | 'ew' | null;
  emergencyOverrideTimer: number;
  nsOccupancy?: OccupancySensorState;
  ewOccupancy?: OccupancySensorState;
}

export interface MapNode {
  id: string;
  x: number;
  z: number;
  type: 'intersection' | 'curve' | 'terminal';
  connectedNodeIds: string[];
  trafficLight?: IntersectionTrafficLight;
}

export interface RoadSegment {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lanes: number;
  length: number;
  speedLimit: number;
  capacity: number;
  currentVehicleCount: number;
  isBlocked: boolean;
  incidentId?: string;
  waypoints: Vector2D[];
}

export interface V2VJournalEntry {
  id: string;
  timestamp: string;
  direction: 'TX' | 'RX';
  counterpartId: string;
  type:
    | 'RIGHT_OF_WAY_CLAIM'
    | 'RIGHT_OF_WAY_YIELD'
    | 'EMERGENCY_CLEAR'
    | 'HAZARD_ALERT'
    | 'PLATOON_SYNC'
    | 'INTERSECTION_LOCK'
    | 'SAFE_GAP_WARNING'
    | 'DETOUR_BROADCAST'
    | 'SIGNAL_PREEMPTION'
    | 'V2P_CROSSWALK_ALERT'
    | 'TRAFFIC_JAM_SHOCKWAVE'
    | 'TRAFFIC_JAM_CASCADE'
    | 'BOX_CLEARANCE_DISPATCH'
    | 'GRIDLOCK_PREVENTION'
    | 'EEBL_EMERGENCY_BRAKE'
    | 'CACC_PLATOON_SYNC'
    | 'DYNAMIC_DETOUR'
    | 'OVERTAKE_INTENT';
  content: string;
  negotiatedAction: string;
}

export interface V2VBubble {
  id: string;
  vehicleId: string;
  type: string;
  text: string;
  x: number;
  z: number;
  timestamp: number;
}

export interface PedestrianAgent {
  id: string;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  speed: number;
  heading: number;
  status: 'walking' | 'waiting_curb' | 'crossing';
  isCrossingCrosswalk: boolean;
  crosswalkNodeId?: string;
  color: string;
  legAngle: number;
}

export interface VehicleAgent {
  id: string;
  type: VehicleType;
  x: number;
  z: number;
  heading: number; // in radians
  speed: number; // m/s
  targetSpeed: number;
  maxSpeed: number;
  acceleration: number;
  accelerationG: number;
  status: VehicleStatus;
  priority: number; // 1-10
  color: string;
  currentNodeId: string;
  targetNodeId: string;
  path: Vector2D[];
  pathNodeIds: string[];
  pathIndex: number;
  v2vNeighbors: string[];
  avoidanceRadius: number;
  waitTime: number;
  distanceTraveled: number;
  rerouteCount: number;
  activeIncidentDetected?: string;
  pathEfficiency: number; // percentage (0-100)
  activeLuaRule: string;
  sirenActive?: boolean;
  v2vJournal: V2VJournalEntry[];
  jamCascadeReceivedTime?: number;
  cascadeHopCount?: number;
  lateralOffset?: number; // current lateral shift from lane centerline in meters
  targetLateralOffset?: number; // target lateral shift (+2.4m for corridor pull-over, 0 for normal)
  isYieldingToEmergency?: boolean; // active corridor clearance state
  emergencyClearanceTimer?: number; // time when vehicle can safely merge back
  isInsideIntersectionBox?: boolean; // currently traversing inside intersection box (-7.8m to +7.8m)
  boxClearancePriority?: boolean; // active right-of-way token to clear blocked box
  boxClearanceTimer?: number; // expiry for box clearance override
  approachingNodeId?: string; // immediate physical intersection node
  platoonLeaderId?: string; // lead vehicle ID for CACC platooning
  isPlatoonFollower?: boolean; // whether vehicle is in locked CACC platoon following
  hazardLightsActive?: boolean; // four-way hazard flashers (e.g. EEBL hard braking / breakdown)
  lastRerouteEvaluationTime?: number; // timestamp of last in-route dynamic A* check
  overtakeState?: 'none' | 'pulling_out' | 'passing' | 'returning';
  overtakeTimer?: number;
  ttc?: number; // instantaneous Time-To-Collision in seconds
}

export interface Incident {
  id: string;
  type: 'roadblock' | 'accident' | 'traffic_jam' | 'construction' | 'hazard';
  x: number;
  z: number;
  radius: number;
  label: string;
  timestamp: number;
  affectsRoadIds: string[];
  severity?: number;
}

export type V2VMessageType =
  | 'hazard_alert'
  | 'route_yield'
  | 'platoon_sync'
  | 'reroute_notice'
  | 'right_of_way_claim'
  | 'right_of_way_yield'
  | 'emergency_clear'
  | 'intersection_lock'
  | 'v2p_yield'
  | 'signal_preemption'
  | 'traffic_jam_cascade'
  | 'box_clearance'
  | 'gridlock_hold'
  | 'eebl_emergency_brake'
  | 'cacc_platoon_sync'
  | 'dynamic_detour'
  | 'overtake_intent';

export interface V2VLink {
  fromId: string;
  toId: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  messageType: V2VMessageType;
  timestamp: number;
}

export interface EmergencyFleetMetrics {
  preemptionSuccessRate: number; // 0 - 100%
  avgAvoidanceLatencyMs: number; // response time in milliseconds
  corridorClearanceRate: number; // 0 - 100%
  activeEmergencyUnits: number;
  greenWaveIntersectionsCount: number;
  civilianYieldCount: number;
  totalPreemptionEvents: number;
}

export interface SimulationMetrics {
  fps: number;
  activeVehicles: number;
  throughputPerMin: number;
  avgSpeedKmh: number;
  avgDelaySeconds: number;
  totalReroutes: number;
  v2vPacketsPerSec: number;
  collisionRiskIndex: number; // 0.0 - 1.0
  simTimeSeconds: number;
  completedTrips: number;
  emergencyMetrics: EmergencyFleetMetrics;
}

export type ScenarioType =
  | 'rush_hour'
  | 'bottleneck'
  | 'emergency_corridor'
  | 'gridlock'
  | 'incident_recovery'
  | 'police_pursuit'
  | 'fire_rescue'
  | 'vip_motorcade';

export interface ScenarioConfig {
  id: ScenarioType;
  name: string;
  description: string;
  vehicleCount: number;
  spawnRates: Record<VehicleType, number>;
  initialIncidents: Incident[];
  emergencyPriorityMultiplier: number;
}
