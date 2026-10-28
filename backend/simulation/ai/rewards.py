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
Calibrated multi-objective reward engine for multi-agent traffic coordination.
Balances safety, efficiency, comfort, traffic signal compliance, and emergency cooperation.
"""

from __future__ import annotations

import math
from typing import Dict, TYPE_CHECKING

from ..rule_engine import EMERGENCY_TYPES
from ..types import VehicleAgent
from .actions import VehicleAction

if TYPE_CHECKING:
    from ..engine import SimulationEngine


class RewardCalculator:
    """
    Computes individual and cooperative multi-objective rewards per vehicle step.
    Weights are calibrated to keep total step rewards within [-1.0, +1.0] under normal driving,
    with distinct negative penalty spikes for critical safety/rule violations.
    """

    def __init__(self) -> None:
        # Calibration weights
        self.w_progress = 0.35
        self.w_speed = 0.20
        self.w_stop = 0.08
        self.w_comfort = 0.05
        self.w_ttc = 1.50
        self.w_collision = 25.0
        self.w_red_light = 15.0
        self.w_pedestrian = 20.0
        self.w_emergency_yield = 2.00
        self.w_emergency_speed = 0.80
        self.w_platoon = 0.15

    def compute_step_reward(
        self,
        v: VehicleAgent,
        action: VehicleAction,
        engine: SimulationEngine,
        dt: float,
    ) -> float:
        """Computes scalar reward for vehicle `v` after taking `action`."""
        is_emergency = v.type in EMERGENCY_TYPES
        r_total = 0.0

        # 1. Forward Route Progress
        move_dist = v.speed * dt
        norm_progress = np_clip = min(1.0, move_dist / max(0.1, v.max_speed * dt))
        r_total += self.w_progress * norm_progress

        # 2. Cruise Speed Efficiency
        speed_ratio = min(1.0, v.speed / max(1.0, v.target_speed))
        r_total += self.w_speed * speed_ratio

        # 3. Unnecessary Stop Penalty (starvation / stalling)
        if v.speed < 0.2 and v.status not in ("yielding", "braking") and not v.is_inside_intersection_box:
            r_total -= self.w_stop

        # 4. Ride Comfort & Jerk (penalize extreme acceleration changes)
        accel_ratio = abs(action.accel) / 4.0
        r_total -= self.w_comfort * (accel_ratio ** 2)

        # 5. Collision & Severe Near-Collision Penalties
        min_lead_dist = getattr(v, "_current_lead_dist", 999.0)
        if min_lead_dist < 2.5:
            # Physical collision
            r_total -= self.w_collision
        elif min_lead_dist < 5.0:
            # Near-collision bumper violation
            r_total -= self.w_collision * 0.4

        # 6. Time-to-Collision (TTC) Hazard Penalty
        ttc = getattr(v, "ttc", None)
        if ttc is not None and ttc < 1.4:
            ttc_hazard = max(0.0, 1.4 - ttc) / 1.4
            r_total -= self.w_ttc * ttc_hazard

        # 7. Red-Light Compliance
        approaching_red = self._check_red_light_intrusion(v, engine)
        if approaching_red:
            r_total -= self.w_red_light

        # 8. Pedestrian Conflict Penalty
        has_ped = engine.pedestrian_manager.is_pedestrian_crossing_near(v.x, v.z, radius=5.0)
        if has_ped and v.speed > 1.5:
            r_total -= self.w_pedestrian

        # 9. Emergency Vehicle Coordination
        if is_emergency:
            # Emergency responder rewarded for high response speed and rapid progress
            r_total += self.w_emergency_speed * (v.speed / max(1.0, v.max_speed))
        else:
            # Civilian vehicles rewarded for yielding when emergency vehicle is nearby
            emergency_near = any(
                other.type in EMERGENCY_TYPES and math.hypot(other.x - v.x, other.z - v.z) < 35.0
                for other in engine.vehicles
            )
            if emergency_near:
                if v.status == "yielding" or abs(v.lateral_offset) > 1.2:
                    r_total += self.w_emergency_yield
                elif v.speed > 8.0:
                    r_total -= self.w_emergency_yield * 1.5  # Blocking emergency corridor

        # 10. Cooperative CACC Platooning Bonus
        if getattr(v, "is_platoon_follower", False):
            r_total += self.w_platoon

        return float(r_total)

    def _check_red_light_intrusion(self, v: VehicleAgent, engine: SimulationEngine) -> bool:
        """Checks if vehicle is speeding into an intersection against a red signal."""
        for node in engine.city.nodes.values():
            if node.traffic_light:
                d = math.hypot(node.x - v.x, node.z - v.z)
                if d < 12.0:
                    is_ns = abs(math.cos(v.heading)) > abs(math.sin(v.heading))
                    color = node.traffic_light.ns_state if is_ns else node.traffic_light.ew_state
                    if color == "red" and v.speed > 3.0:
                        return True
        return False

