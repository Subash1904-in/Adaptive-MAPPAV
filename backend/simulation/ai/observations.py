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
Observation builder for multi-agent autonomous vehicle policies.
Converts local spatial, kinematic, signal, and V2V telemetry into normalized 32-D vectors.
"""

from __future__ import annotations

import math
from typing import List, TYPE_CHECKING
import numpy as np

from ..rule_engine import EMERGENCY_TYPES
from ..types import VehicleAgent

if TYPE_CHECKING:
    from ..engine import SimulationEngine

OBSERVATION_DIM = 32


class ObservationBuilder:
    """Constructs decentralized observation vectors for individual vehicles."""

    def __init__(self) -> None:
        self.dim = OBSERVATION_DIM

    def build(self, v: VehicleAgent, engine: SimulationEngine) -> np.ndarray:
        """
        Constructs a 32-dimensional normalized feature vector for vehicle `v`.
        All components are bounded to [-1.0, +1.0] or [0.0, +1.0].
        """
        obs = np.zeros(OBSERVATION_DIM, dtype=np.float32)

        is_emergency = v.type in EMERGENCY_TYPES
        max_speed = max(1.0, v.max_speed)

        # 1. Ego Kinematics (0 - 4)
        obs[0] = np.clip(v.speed / max_speed, 0.0, 1.5)
        obs[1] = math.sin(v.heading)
        obs[2] = math.cos(v.heading)
        obs[3] = np.clip(v.acceleration / 4.0, -1.0, 1.0)
        obs[4] = np.clip(v.lateral_offset / 3.0, -1.0, 1.0)

        # 2. Trip Progress & Destination (5 - 8)
        dest_dist = 100.0
        if v.path and len(v.path) > 0:
            target_pt = v.path[-1]
            dest_dist = math.hypot(target_pt["x"] - v.x, target_pt["z"] - v.z)
        obs[5] = np.clip(dest_dist / 300.0, 0.0, 1.0)

        path_len = len(v.path) if v.path else 1
        obs[6] = np.clip(v.path_index / max(1, path_len), 0.0, 1.0)
        obs[7] = 1.0 if is_emergency else 0.0
        obs[8] = np.clip(v.priority / 10.0, 0.1, 1.0)

        # 3. Lead & Trailing Vehicles / Car-Following (9 - 13)
        lead_dist = getattr(v, "_current_lead_dist", 999.0)
        lead_veh = getattr(v, "_current_lead_veh", None)
        obs[9] = np.clip(lead_dist / 50.0, 0.0, 1.0) if lead_dist < 900.0 else 1.0

        if lead_veh is not None:
            rel_speed = (v.speed - lead_veh.speed) / 15.0
            obs[10] = np.clip(rel_speed, -1.0, 1.0)
        else:
            obs[10] = 0.0

        ttc = getattr(v, "ttc", None)
        obs[11] = np.clip(ttc / 10.0, 0.0, 1.0) if ttc is not None else 1.0

        # Trailing vehicle distance
        tail_dist = 999.0
        v_hvec = (math.sin(v.heading), math.cos(v.heading))
        for other in engine.vehicles:
            if other.id == v.id:
                continue
            dx = other.x - v.x
            dz = other.z - v.z
            d = math.hypot(dx, dz)
            if d < 40.0:
                # Behind ego vehicle
                backward_dot = -(dx * v_hvec[0] + dz * v_hvec[1])
                if backward_dot > 0.6 and d < tail_dist:
                    tail_dist = d
        obs[12] = np.clip(tail_dist / 50.0, 0.0, 1.0) if tail_dist < 900.0 else 1.0

        # Safe time headway (seconds)
        time_headway = (lead_dist / max(0.2, v.speed)) if lead_dist < 900.0 else 10.0
        obs[13] = np.clip(time_headway / 5.0, 0.0, 1.0)

        # 4. Traffic Signals & Intersections (14 - 18)
        sig_dist, sig_color, phase_rem, in_box = self._get_signal_features(v, engine)
        obs[14] = np.clip(sig_dist / 80.0, 0.0, 1.0)
        obs[15] = 1.0 if sig_color == "green" else 0.0
        obs[16] = 1.0 if sig_color == "yellow" else 0.0
        obs[17] = 1.0 if sig_color == "red" else 0.0
        obs[18] = np.clip(phase_rem / 26.0, 0.0, 1.0)

        # 5. Road Network, Incidents & Crosswalks (19 - 23)
        obs[19] = 1.0 if in_box else 0.0
        nearest_inc_dist = 999.0
        for inc in engine.incidents:
            idist = math.hypot(inc.x - v.x, inc.z - v.z)
            if idist < nearest_inc_dist:
                nearest_inc_dist = idist
        obs[20] = np.clip(nearest_inc_dist / 80.0, 0.0, 1.0) if nearest_inc_dist < 900.0 else 1.0

        # Pedestrian conflict
        has_ped = engine.pedestrian_manager.is_pedestrian_crossing_near(v.x, v.z, radius=12.0)
        obs[21] = 1.0 if has_ped else 0.0

        # Road occupancy ratio
        occ_ratio = 0.0
        if v.path_node_ids and len(v.path_node_ids) > 1:
            idx = min(v.path_index, len(v.path_node_ids) - 2)
            rid = f"road_{v.path_node_ids[idx]}_{v.path_node_ids[idx + 1]}"
            road = engine.city.roads.get(rid)
            if road and road.capacity > 0:
                occ_ratio = road.current_vehicle_count / road.capacity
        obs[22] = np.clip(occ_ratio, 0.0, 2.0) / 2.0
        obs[23] = np.clip(v.wait_time / 20.0, 0.0, 1.0)

        # 6. Candidate Alternative Routes (24 - 26)
        cand_costs = self._get_candidate_route_costs(v, engine)
        obs[24] = np.clip(cand_costs[0] / 300.0, 0.0, 1.0)
        obs[25] = np.clip(cand_costs[1] / 300.0, 0.0, 1.0)
        obs[26] = np.clip(cand_costs[2] / 300.0, 0.0, 1.0)

        # 7. V2V Communication Buffer (27 - 31)
        emerg_beacon = False
        emerg_dist = 999.0
        eebl_active = False
        platoon_avail = False

        for nid in v.v2v_neighbors:
            other = next((o for o in engine.vehicles if o.id == nid), None)
            if other:
                odist = math.hypot(other.x - v.x, other.z - v.z)
                if other.type in EMERGENCY_TYPES:
                    emerg_beacon = True
                    emerg_dist = min(emerg_dist, odist)
                if getattr(other, "hazard_lights_active", False):
                    eebl_active = True
                if (
                    not is_emergency
                    and other.type not in EMERGENCY_TYPES
                    and other.speed > 4.0
                    and odist < 25.0
                ):
                    platoon_avail = True

        obs[27] = 1.0 if emerg_beacon else 0.0
        obs[28] = np.clip(emerg_dist / 60.0, 0.0, 1.0) if emerg_dist < 900.0 else 1.0
        obs[29] = 1.0 if eebl_active else 0.0
        obs[30] = 1.0 if platoon_avail else 0.0
        obs[31] = 1.0 if v.is_platoon_follower else 0.0

        return obs

    def build_batch(self, vehicles: List[VehicleAgent], engine: SimulationEngine) -> np.ndarray:
        """Vectorized builder for all active vehicles."""
        if not vehicles:
            return np.zeros((0, OBSERVATION_DIM), dtype=np.float32)
        batch = np.zeros((len(vehicles), OBSERVATION_DIM), dtype=np.float32)
        for i, v in enumerate(vehicles):
            batch[i] = self.build(v, engine)
        return batch

    def _get_signal_features(self, v: VehicleAgent, engine: SimulationEngine):
        """Finds approaching intersection traffic light distance and state."""
        min_dist = 999.0
        light_color = "green"
        phase_rem = 20.0
        in_box = v.is_inside_intersection_box

        for node_id, node in engine.city.nodes.items():
            if node.traffic_light:
                d = math.hypot(node.x - v.x, node.z - v.z)
                if d < min_dist:
                    min_dist = d
                    # Heading alignment with NS or EW axis
                    is_ns = abs(math.cos(v.heading)) > abs(math.sin(v.heading))
                    light_color = node.traffic_light.ns_state if is_ns else node.traffic_light.ew_state
                    phase_rem = node.traffic_light.phase_time_remaining

        return min_dist, light_color, phase_rem, in_box

    def _get_candidate_route_costs(self, v: VehicleAgent, engine: SimulationEngine) -> tuple[float, float, float]:
        """Provides estimated cost of 3 candidate routes (current, detour, bypass)."""
        base_cost = 100.0
        if v.path:
            remaining_pts = len(v.path) - v.path_index
            base_cost = remaining_pts * 2.5

        # Heuristic costs based on active incidents
        detour_cost = base_cost * 1.2
        bypass_cost = base_cost * 1.4

        if v.active_incident_detected:
            base_cost += 150.0  # Penalized by blockage
            detour_cost = base_cost * 0.7  # Detour is more attractive

        return base_cost, detour_cost, bypass_cost

