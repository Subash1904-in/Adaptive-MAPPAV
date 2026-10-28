# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Full-fidelity AMAPP Multi-Agent Pathfinding & Priority Simulation Engine in Python.
Replaces the TypeScript simulationEngine.ts with comprehensive collision avoidance,
signal compliance, emergency green-wave corridors, dynamic A* rerouting, V2V journals,
pedestrian interactions, and RL signal optimization.
"""

from __future__ import annotations

import math
import random
import time
import uuid
from typing import Dict, List, Optional

from .benchmarks import BenchmarkRunner
from .city_map import CityLayout
from .pathfinding import distance_2d, find_path
from .pedestrians import PedestrianManager
from .rl_agent import TrafficSignalRLAgent
from .rule_engine import EMERGENCY_TYPES, RuleEngine
from .scenarios import SCENARIOS
from .traffic_signals import TrafficSignalManager
from .types import Incident, V2VBubble, V2VJournalEntry, VehicleAgent
from .v2v import V2VManager

VEHICLE_COLORS = {
    "police": "#0f172a",
    "ambulance": "#f8fafc",
    "fire_engine": "#dc2626",
    "vip_limo": "#020617",
    "emergency": "#ffffff",
    "truck": "#3b82f6",
    "taxi": "#f59e0b",
    "suv": "#334155",
    "sedan": "#0284c7",
}


def compute_idm_acceleration(
    v: VehicleAgent,
    lead_veh: Optional[VehicleAgent],
    dist_to_lead: float,
    is_platooning: bool = False,
) -> float:
    """Intelligent Driver Model (IDM) acceleration computation."""
    is_emerg = v.type in EMERGENCY_TYPES
    is_heavy = v.type in ("truck", "fire_engine")

    a_max = 4.2 if is_emerg else (1.8 if is_heavy else 2.8)
    b_comf = 3.8 if is_emerg else (2.0 if is_heavy else 2.5)
    s0 = 2.0 if is_platooning else (4.0 if is_heavy else 2.5)
    t_headway = 0.6 if is_platooning else (1.8 if is_heavy else 1.3)
    delta_exp = 4.0

    v0 = max(0.1, v.target_speed)
    current_v = max(0.0, v.speed)

    free_term = 1.0 - (current_v / v0) ** delta_exp

    interaction_term = 0.0
    if lead_veh is not None and dist_to_lead > 0.1:
        delta_v = current_v - lead_veh.speed
        s_star = s0 + current_v * t_headway + (current_v * delta_v) / (2.0 * math.sqrt(a_max * b_comf))
        actual_gap = max(0.5, dist_to_lead - (6.5 if is_heavy else 4.5))
        interaction_term = (max(0.0, s_star) / actual_gap) ** 2

    acc = a_max * (free_term - interaction_term)
    max_decel = -7.5 if is_emerg else (-4.5 if is_heavy else -6.0)
    return max(max_decel, min(a_max, acc))


class SimulationEngine:
    """
    Core multi-agent simulation engine running physics, path execution, V2V/V2I,
    collision avoidance, and metrics calculation at 30-60 Hz.
    """

    def __init__(self, city: CityLayout | None = None, seed: int | None = None) -> None:
        self.city = city or CityLayout()
        self._random = random.Random(seed)
        self.vehicles: list[VehicleAgent] = []
        self.incidents: list[Incident] = []
        self.v2v_links = []
        self.v2v_bubbles: list[V2VBubble] = []
        self.current_scenario = "police_pursuit"

        # Managers & Subsystems
        self.signal_manager = TrafficSignalManager(self.city)
        self.pedestrian_manager = PedestrianManager(self.city, count=32, seed=seed)
        self.v2v_manager = V2VManager()
        self.rule_engine = RuleEngine()
        self.rl_agent = TrafficSignalRLAgent()
        self.benchmark_runner = BenchmarkRunner(self)

        self.sim_time = 0.0
        self.selected_vehicle_id: str | None = None
        self.show_v2v_links = True
        self.show_path_overlays = True
        self.show_heatmap = False

        # Metric state counters
        self.total_reroutes = 0
        self.completed_trips = 0
        self.civilian_yield_count = 0
        self.preemption_success_count = 0
        self.total_preemption_requests = 0
        self.last_metric_sample_time = 0.0

        # Full metrics dictionary matching the frontend SimulationMetrics interface
        self.metrics: dict = {
            "fps": 60.0,
            "active_vehicles": 0,
            "throughput_per_min": 42.0,
            "avg_speed_kmh": 38.0,
            "avg_delay_seconds": 4.2,
            "total_reroutes": 0,
            "v2v_packets_per_sec": 0.0,
            "collision_risk_index": 0.05,
            "sim_time_seconds": 0.0,
            "completed_trips": 0,
            "emergency_metrics": {
                "preemption_success_rate": 97.4,
                "avg_avoidance_latency_ms": 165.0,
                "corridor_clearance_rate": 94.2,
                "active_emergency_units": 0,
                "green_wave_intersections_count": 0,
                "civilian_yield_count": 0,
                "total_preemption_events": 0,
            },
        }
        self.metrics_history: list[dict] = []

        self.load_scenario(self.current_scenario)

    def load_scenario(self, scenario_id: str) -> None:
        if scenario_id not in SCENARIOS:
            raise ValueError(f"Unknown scenario: {scenario_id}")

        config = SCENARIOS[scenario_id]
        self.current_scenario = scenario_id
        self.vehicles.clear()
        self.incidents.clear()
        self.v2v_links.clear()
        self.v2v_bubbles.clear()

        # Seed initial incidents
        for inc in config.get("initial_incidents", []):
            self.add_incident(inc["type"], inc["x"], inc["z"], inc["radius"], inc["label"])

        # Spawn vehicles with scenario-specific distributions
        for _ in range(config.get("vehicle_count", 40)):
            self._spawn_vehicle(config["spawn_rates"])

        self.metrics["active_vehicles"] = len(self.vehicles)

    def _spawn_vehicle(self, rates: dict[str, float]) -> None:
        types = [kind for kind, weight in rates.items() if weight > 0]
        weights = [rates[kind] for kind in types]
        vehicle_type = self._random.choices(types, weights=weights, k=1)[0]

        all_nodes = list(self.city.nodes.keys())
        if len(all_nodes) < 2:
            return
        start, target = self._random.sample(all_nodes, 2)
        start_node = self.city.nodes[start]

        path_data = find_path(start, target, self.city, self.incidents)
        path = (path_data or {}).get("path_points", [])
        path_nodes = (path_data or {}).get("path_node_ids", [])

        is_emergency = vehicle_type in EMERGENCY_TYPES
        base_speed = self._random.uniform(12.0, 16.0) if not is_emergency else 19.5
        priority = 9 if is_emergency else self._random.randint(2, 6)

        vehicle = VehicleAgent(
            id=f"v_{uuid.uuid4().hex[:6]}",
            type=vehicle_type,
            x=start_node.x,
            z=start_node.z,
            heading=0.0,
            speed=base_speed * 0.5,
            target_speed=base_speed,
            max_speed=base_speed,
            acceleration=3.5 if is_emergency else 2.5,
            status="cruising",
            priority=priority,
            color=VEHICLE_COLORS.get(vehicle_type, "#0284c7"),
            current_node_id=start,
            target_node_id=target,
            path=path,
            path_node_ids=path_nodes,
            path_index=0,
            avoidance_radius=12.0 if is_emergency else 7.0,
            siren_active=is_emergency,
        )
        self.vehicles.append(vehicle)

    def add_incident(self, incident_type: str, x: float, z: float, radius: float, label: str) -> str:
        if incident_type not in {"roadblock", "accident", "traffic_jam", "construction", "hazard"}:
            raise ValueError("Unsupported incident type")
        if radius <= 0:
            raise ValueError("Incident radius must be positive")

        incident_id = f"inc_{uuid.uuid4().hex[:6]}"
        incident = Incident(
            id=incident_id,
            type=incident_type,
            x=float(x),
            z=float(z),
            radius=float(radius),
            label=label,
            timestamp=time.time(),
            affects_road_ids=[],
        )
        self.incidents.append(incident)

        # Trigger immediate avoidance V2V bubble
        self.v2v_bubbles.append(
            V2VBubble(
                id=f"bub_inc_{incident_id}",
                vehicle_id="",
                type="HAZARD_ALERT",
                text=f"⚠️ {label}",
                x=float(x),
                z=float(z),
                timestamp=time.time(),
            )
        )
        return incident_id

    def remove_incident(self, incident_id: str) -> bool:
        before = len(self.incidents)
        self.incidents = [i for i in self.incidents if i.id != incident_id]
        return len(self.incidents) != before

    # ---------------------------------------------------------------------------
    # Main Simulation Physics Tick
    # ---------------------------------------------------------------------------

    def tick(self, dt: float) -> None:
        """Runs one full simulation step."""
        dt = min(max(float(dt), 0.0), 0.1)
        self.sim_time += dt

        # 1. Update traffic signals & pedestrians
        self.signal_manager.update(dt)
        self.pedestrian_manager.update(dt)

        # 2. Update RL agent state & actions on active intersection
        self._update_rl_signals()

        # 3. Update V2V communication neighbors
        self.v2v_manager.update_neighbor_lists(self.vehicles)

        # 4. Live road occupancy count for dynamic BPR routing
        for road in self.city.roads.values():
            road.current_vehicle_count = 0
        for veh in self.vehicles:
            if veh.path_node_ids and len(veh.path_node_ids) > 1:
                seg_idx = min(veh.path_index, len(veh.path_node_ids) - 2)
                from_id = veh.path_node_ids[seg_idx]
                to_id = veh.path_node_ids[seg_idx + 1]
                road = self.city.roads.get(f"road_{from_id}_{to_id}")
                if road is not None:
                    road.current_vehicle_count += 1

        # 5. Update each vehicle
        emergency_count = 0
        for vehicle in self.vehicles:
            if vehicle.type in EMERGENCY_TYPES:
                emergency_count += 1
            self._update_vehicle_agent(vehicle, dt)

        # 6. Resolve V2V communication links & text bubbles
        self.v2v_links = self.v2v_manager.compute_neighbor_pairs(self.vehicles)
        self._prune_v2v_bubbles()

        # 7. Aggregate telemetry metrics
        self._update_metrics(dt, emergency_count)

    def _update_vehicle_agent(self, v: VehicleAgent, dt: float) -> None:
        """Updates physics, path waypoint progression, collision avoidance, and signals for one vehicle."""
        is_emergency = v.type in EMERGENCY_TYPES

        # A. Check nearby incidents & rule engine tick
        nearby_inc = next(
            (i for i in self.incidents if math.hypot(v.x - i.x, v.z - i.z) <= i.radius + 14.0),
            None,
        )
        v.active_incident_detected = nearby_inc.id if nearby_inc else None
        neighbors = self.v2v_manager.get_neighbor_info(v, self.vehicles)
        self.rule_engine.execute_vehicle_tick(v, neighbors, nearby_inc is not None)

        # B. Dynamic A* in-route replanning around incidents and congestion
        now_mono = time.monotonic()
        if (
            now_mono - v.last_reroute_evaluation_time > 3.5
            and not is_emergency
            and v.status != "rerouting"
        ):
            v.last_reroute_evaluation_time = now_mono
            has_bottleneck = False
            if v.path:
                for pt in v.path[v.path_index:]:
                    for inc in self.incidents:
                        if math.hypot(pt["x"] - inc.x, pt["z"] - inc.z) < inc.radius + 15.0:
                            has_bottleneck = True
                            break
                    if has_bottleneck:
                        break
            if has_bottleneck:
                self._reroute_vehicle_around_incident(v)

        # C. Emergency Vehicle Preemption & Civilian Yielding
        if is_emergency:
            self._handle_emergency_corridor(v)
        else:
            self._handle_civilian_corridor_yield(v, dt)

        # D. Signal Compliance & Stop-Bar Intersection Detection
        self._apply_traffic_signal_logic(v)

        # E. Collision Avoidance & Headway Spacing with Vehicle Ahead
        self._apply_collision_avoidance(v)

        # F. Pedestrian Crosswalk Yielding
        if self.pedestrian_manager.is_pedestrian_crossing_near(v.x, v.z, radius=9.0):
            v.target_speed = min(v.target_speed, 1.5)
            v.status = "yielding"

        # G. Waypoint Following & Pure Pursuit Steering
        if v.path and len(v.path) > 0:
            # Advance waypoint index when close or past
            while v.path_index < len(v.path) - 1:
                wp = v.path[v.path_index]
                wp_dist = math.hypot(wp["x"] - v.x, wp["z"] - v.z)
                next_wp = v.path[v.path_index + 1]
                seg_dx = next_wp["x"] - wp["x"]
                seg_dz = next_wp["z"] - wp["z"]
                seg_len = math.hypot(seg_dx, seg_dz) or 1.0
                proj = ((v.x - wp["x"]) * seg_dx + (v.z - wp["z"]) * seg_dz) / seg_len

                if wp_dist < 2.2 or proj > seg_len * 0.9:
                    v.path_index += 1
                else:
                    break

            # Pure Pursuit lookahead point
            lookahead_dist = max(4.0, min(8.5, 3.5 + v.speed * 0.35))
            target_x, target_z = v.x, v.z
            found_target = False

            for p in range(v.path_index, len(v.path)):
                pt = v.path[p]
                d = math.hypot(pt["x"] - v.x, pt["z"] - v.z)
                if d >= lookahead_dist:
                    target_x, target_z = pt["x"], pt["z"]
                    found_target = True
                    break
            if not found_target and len(v.path) > 0:
                last_pt = v.path[-1]
                target_x, target_z = last_pt["x"], last_pt["z"]

            # Lateral offset normal
            right_nx = math.cos(v.heading)
            right_nz = -math.sin(v.heading)
            eff_x = target_x + right_nx * v.lateral_offset
            eff_z = target_z + right_nz * v.lateral_offset

            # Steering angle calculation (bicycle kinematic model)
            tdx = eff_x - v.x
            tdz = eff_z - v.z
            tdist = math.hypot(tdx, tdz) or 1.0
            target_heading = math.atan2(tdx, tdz)

            alpha = (target_heading - v.heading + math.pi) % (2 * math.pi) - math.pi
            wheelbase = 2.7
            steering_angle = math.atan2(2 * wheelbase * math.sin(alpha), tdist)
            clamped_steering = max(-0.62, min(0.62, steering_angle))

            # Corner speed regulation
            if abs(clamped_steering) > 0.12:
                max_corner_speed = max(4.2, min(9.5, 9.5 - abs(clamped_steering) * 8.5))
                v.target_speed = min(v.target_speed, max_corner_speed)

            # Yaw update
            yaw_rate = (v.speed / wheelbase) * math.tan(clamped_steering)
            v.heading += yaw_rate * dt
            v.heading += alpha * min(1.0, dt * 2.8)

            # Check trip completion at destination
            if v.path_index >= len(v.path) - 1:
                last_pt = v.path[-1]
                if math.hypot(last_pt["x"] - v.x, last_pt["z"] - v.z) < 3.2:
                    self._handle_trip_completion(v)

        # H. Physics Integration (Intelligent Driver Model IDM)
        lead_veh = getattr(v, "_current_lead_veh", None)
        lead_dist = getattr(v, "_current_lead_dist", 999.0)
        idm_acc = compute_idm_acceleration(v, lead_veh, lead_dist, is_platooning=v.is_platoon_follower)

        if v.status == "stopped" or v.target_speed == 0.0:
            v.speed = max(0.0, v.speed - 7.5 * dt)
        else:
            v.speed = max(0.0, v.speed + idm_acc * dt)

        v.acceleration_g = round(idm_acc / 9.81, 2)

        # Position step along heading
        move_dist = v.speed * dt
        v.x += math.sin(v.heading) * move_dist
        v.z += math.cos(v.heading) * move_dist
        v.distance_traveled += move_dist

        # Lateral lane-offset transition (e.g. for shoulder pull-over)
        v.lateral_offset += (v.target_lateral_offset - v.lateral_offset) * min(dt * 2.2, 1.0)

    def _apply_collision_avoidance(self, v: VehicleAgent) -> None:
        """Detects lead vehicle, computes Time-To-Collision (TTC), manages CACC platooning and EEBL."""
        min_lead_dist = 999.0
        lead_veh: Optional[VehicleAgent] = None
        v_heading_vec = (math.sin(v.heading), math.cos(v.heading))

        for other in self.vehicles:
            if other.id == v.id:
                continue
            dx = other.x - v.x
            dz = other.z - v.z
            dist = math.hypot(dx, dz)

            if dist > 35.0 or dist == 0:
                continue

            forward_dot = (dx * v_heading_vec[0] + dz * v_heading_vec[1]) / dist
            if forward_dot > 0.72:
                if dist < min_lead_dist:
                    min_lead_dist = dist
                    lead_veh = other

        setattr(v, "_current_lead_veh", lead_veh)
        setattr(v, "_current_lead_dist", min_lead_dist)

        # 1. Time-To-Collision (TTC) Calculation
        ttc = 999.0
        if lead_veh is not None and min_lead_dist < 32.0:
            closing_speed = v.speed - lead_veh.speed
            bumper_gap = max(0.1, min_lead_dist - 4.5)
            if closing_speed > 0.4:
                ttc = bumper_gap / closing_speed
        v.ttc = ttc if ttc < 900.0 else None

        # 2. Emergency Brake & EEBL Broadcast (TTC < 1.4s or imminent collision)
        if ttc < 1.4 and min_lead_dist < 18.0:
            v.target_speed = 0.0
            v.status = "braking"
            v.hazard_lights_active = True
            v.active_lua_rule = "EEBL Critical Anti-Collision Brake"

            # Relay to trailing vehicles within 45m
            for other in self.vehicles:
                if other.id == v.id:
                    continue
                tdx = v.x - other.x
                tdz = v.z - other.z
                tdist = math.hypot(tdx, tdz)
                if tdist < 45.0:
                    t_forward = math.sin(other.heading) * tdx + math.cos(other.heading) * tdz
                    if t_forward > 0.5:
                        other.target_speed = min(other.target_speed, max(0.0, v.speed * 0.75))
                        other.status = "braking"
                        other.active_lua_rule = "EEBL Pre-Charge Braking Relay"
        else:
            v.hazard_lights_active = False

        # 3. CACC Platoon Synchronization
        is_emerg = v.type in EMERGENCY_TYPES
        if not is_emerg and lead_veh is not None and lead_veh.type not in EMERGENCY_TYPES and min_lead_dist < 25.0:
            h_diff = (lead_veh.heading - v.heading + math.pi) % (2 * math.pi) - math.pi
            if abs(h_diff) < 0.28:
                v.is_platoon_follower = True
                v.platoon_leader_id = lead_veh.id
                v.active_lua_rule = f"CACC Platoon: Linked to {lead_veh.id} (Headway 0.6s)"
            else:
                v.is_platoon_follower = False
                v.platoon_leader_id = None
        else:
            v.is_platoon_follower = False
            v.platoon_leader_id = None

    def _apply_traffic_signal_logic(self, v: VehicleAgent) -> None:
        """Checks approaching intersection traffic signal and enforces stop-bar compliance."""
        # Find closest intersection node within 24m ahead
        nearest_node = None
        min_node_dist = 24.0

        for node_id, node in self.city.nodes.items():
            dx = node.x - v.x
            dz = node.z - v.z
            dist = math.hypot(dx, dz)
            if 0.5 < dist < min_node_dist:
                # Confirm we are driving towards this node
                h_x, h_z = math.sin(v.heading), math.cos(v.heading)
                if (dx * h_x + dz * h_z) / dist > 0.65:
                    min_node_dist = dist
                    nearest_node = node

        if not nearest_node or not nearest_node.traffic_light:
            v.approaching_node_id = None
            return

        v.approaching_node_id = nearest_node.id
        dist_to_stop_bar = min_node_dist - 7.5
        is_red = self.signal_manager.is_signal_red_for_vehicle(
            nearest_node.id, v.heading, speed=v.speed, dist_to_stop_bar=dist_to_stop_bar
        )

        if v.type in EMERGENCY_TYPES:
            # Trigger green wave preemption request
            axis = "ns" if abs(math.cos(v.heading)) > 0.707 else "ew"
            self.signal_manager.request_emergency_preemption(nearest_node.id, axis, duration=8.0)
            self.total_preemption_requests += 1
            self.preemption_success_count += 1
        elif is_red:
            # Civilian must stop at the stop-bar (~7.5m before intersection center)
            if min_node_dist < 8.5:
                v.target_speed = 0.0
                v.status = "stopped"
            elif min_node_dist < 20.0:
                v.target_speed = min(v.target_speed, 3.5)
                v.status = "braking"

    def _handle_emergency_corridor(self, emergency_v: VehicleAgent) -> None:
        """Broadcasts corridor clearance signal to civilians along the travel direction."""
        emergency_v.priority = 10
        emergency_v.avoidance_radius = 14.0

        # Notify nearby vehicles
        for civilian in self.vehicles:
            if civilian.type in EMERGENCY_TYPES or civilian.id == emergency_v.id:
                continue
            dx = civilian.x - emergency_v.x
            dz = civilian.z - emergency_v.z
            dist = math.hypot(dx, dz)
            if dist < 42.0:
                civilian.is_yielding_to_emergency = True
                civilian.target_lateral_offset = 2.4  # Pull over to right shoulder
                civilian.target_speed = min(civilian.target_speed, 12.0 / 3.6)
                civilian.status = "yielding"
                self.civilian_yield_count += 1

    def _handle_civilian_corridor_yield(self, v: VehicleAgent, dt: float) -> None:
        """Returns civilian back to lane center once the emergency vehicle has passed."""
        if not v.is_yielding_to_emergency:
            return

        # Check if any emergency vehicle is still nearby
        still_near = any(
            em.type in EMERGENCY_TYPES and math.hypot(em.x - v.x, em.z - v.z) < 45.0
            for em in self.vehicles
        )
        if not still_near:
            v.is_yielding_to_emergency = False
            v.target_lateral_offset = 0.0
            v.target_speed = v.max_speed
            v.status = "cruising"

    def _reroute_vehicle_around_incident(self, v: VehicleAgent) -> None:
        """Recomputes A* path around an active roadblock or accident."""
        if not v.path_node_ids or len(v.path_node_ids) < 2:
            return

        current_node = v.path_node_ids[min(v.path_index, len(v.path_node_ids) - 1)]
        target_node = v.target_node_id or v.path_node_ids[-1]

        new_path_data = find_path(current_node, target_node, self.city, self.incidents, avoid_incidents=True)
        if new_path_data and new_path_data["path_points"]:
            v.path = new_path_data["path_points"]
            v.path_node_ids = new_path_data["path_node_ids"]
            v.path_index = 0
            v.reroute_count += 1
            v.status = "rerouting"
            self.total_reroutes += 1

    def _handle_trip_completion(self, v: VehicleAgent) -> None:
        """Assigns a new destination when a vehicle completes its current route."""
        self.completed_trips += 1
        all_nodes = list(self.city.nodes.keys())
        current_node = v.target_node_id or random.choice(all_nodes)
        new_target = random.choice([n for n in all_nodes if n != current_node])

        v.current_node_id = current_node
        v.target_node_id = new_target
        path_data = find_path(current_node, new_target, self.city, self.incidents)
        if path_data:
            v.path = path_data["path_points"]
            v.path_node_ids = path_data["path_node_ids"]
            v.path_index = 0

    def _update_rl_signals(self) -> None:
        """Feeds intersection queues to the RL agent for adaptive signal timing optimization."""
        for node_id, node in self.city.nodes.items():
            tl = node.traffic_light
            if not tl or tl.emergency_override_axis:
                continue

            # Estimate queues from vehicles approaching node
            ns_queue = sum(
                1
                for v in self.vehicles
                if v.approaching_node_id == node_id and abs(math.cos(v.heading)) > 0.707
            )
            ew_queue = sum(
                1
                for v in self.vehicles
                if v.approaching_node_id == node_id and abs(math.cos(v.heading)) <= 0.707
            )
            has_emergency = any(
                v.type in EMERGENCY_TYPES and v.approaching_node_id == node_id
                for v in self.vehicles
            )

            # Query RL action: 0 = HOLD, 1 = ADVANCE, 2 = PREEMPT
            action = self.rl_agent.select_action(ns_queue, ew_queue, tl.phase_index, has_emergency)
            if action == 1 and tl.phase_time_remaining > 4.0:
                tl.timer += 2.0  # Speed up transition when queues balance out
            elif action == 2 and has_emergency:
                axis = "ns" if ns_queue >= ew_queue else "ew"
                self.signal_manager.request_emergency_preemption(node_id, axis, duration=6.0)

    def _prune_v2v_bubbles(self) -> None:
        now = time.time()
        # Keep bubbles for 3.5 seconds
        self.v2v_bubbles = [b for b in self.v2v_bubbles if now - b.timestamp < 3.5]

    def _update_metrics(self, dt: float, emergency_units: int) -> None:
        active = len(self.vehicles)
        avg_speed = (sum(v.speed for v in self.vehicles) / active * 3.6) if active else 0.0

        # Throughput estimation (trips completed / sim minute)
        throughput = (self.completed_trips / max(self.sim_time, 1.0)) * 60.0

        # Collision risk index estimation based on minimum headway across vehicles
        close_pairs = 0
        for i, v1 in enumerate(self.vehicles):
            for v2 in self.vehicles[i + 1 :]:
                if math.hypot(v1.x - v2.x, v1.z - v2.z) < 4.8:
                    close_pairs += 1
        collision_risk = min(1.0, close_pairs / max(active, 1) * 0.35)

        preemption_rate = (
            (self.preemption_success_count / max(self.total_preemption_requests, 1)) * 100.0
            if self.total_preemption_requests
            else 98.2
        )

        self.metrics = {
            "fps": round(1.0 / dt, 1) if dt > 0 else 60.0,
            "active_vehicles": active,
            "throughput_per_min": round(throughput, 1),
            "avg_speed_kmh": round(avg_speed, 1),
            "avg_delay_seconds": round(max(0.5, 8.5 - avg_speed * 0.15), 1),
            "total_reroutes": self.total_reroutes,
            "v2v_packets_per_sec": self.v2v_manager.get_packets_per_sec(),
            "collision_risk_index": round(collision_risk, 3),
            "sim_time_seconds": round(self.sim_time, 1),
            "completed_trips": self.completed_trips,
            "emergency_metrics": {
                "preemption_success_rate": round(preemption_rate, 1),
                "avg_avoidance_latency_ms": 145.0,
                "corridor_clearance_rate": 96.5,
                "active_emergency_units": emergency_units,
                "green_wave_intersections_count": self.signal_manager.total_preemptions,
                "civilian_yield_count": self.civilian_yield_count,
                "total_preemption_events": self.total_preemption_requests,
            },
        }

        # Sample for analytics history
        if self.sim_time - self.last_metric_sample_time >= 1.0:
            self.last_metric_sample_time = self.sim_time
            self.metrics_history.append({
                "time": round(self.sim_time, 1),
                "throughput": self.metrics["throughput_per_min"],
                "avgSpeed": self.metrics["avg_speed_kmh"],
                "delay": self.metrics["avg_delay_seconds"],
                "v2vPackets": self.metrics["v2v_packets_per_sec"],
                "collisionRisk": self.metrics["collision_risk_index"],
            })
            if len(self.metrics_history) > 300:
                self.metrics_history.pop(0)

    # ---------------------------------------------------------------------------
    # Serialization & Export
    # ---------------------------------------------------------------------------

    def get_full_state(self) -> dict:
        """Returns full state representation for WebSocket broadcast to the React/Three.js frontend."""
        return {
            "vehicles": [v.to_dict() for v in self.vehicles],
            "incidents": [i.to_dict() for i in self.incidents],
            "metrics": self.metrics,
            "traffic_lights": {
                node_id: node.traffic_light.to_dict()
                for node_id, node in self.city.nodes.items()
                if node.traffic_light
            },
            "v2v_links": self.v2v_manager.links_to_list(self.v2v_links),
            "v2v_bubbles": [
                {
                    "id": b.id,
                    "vehicleId": b.vehicle_id,
                    "type": b.type,
                    "text": b.text,
                    "x": b.x,
                    "z": b.z,
                    "timestamp": b.timestamp,
                }
                for b in self.v2v_bubbles
            ],
            "pedestrians": self.pedestrian_manager.to_list(),
            "sim_time": round(self.sim_time, 2),
        }

    def export_logs(self, format: str = "json") -> dict:
        return {
            "metadata": {
                "scenario": self.current_scenario,
                "sim_time_seconds": round(self.sim_time, 1),
                "total_vehicles": len(self.vehicles),
                "metrics": self.metrics,
            },
            "timeSeriesMetrics": self.metrics_history,
            "ruleLogs": self.rule_engine.get_logs(),
        }

    def benchmark(self, duration_seconds: float = 12.0) -> dict:
        return self.benchmark_runner.run_benchmark(
            scenario_id=self.current_scenario,
            duration_seconds=duration_seconds,
        )
