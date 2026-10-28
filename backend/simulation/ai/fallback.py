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
Deterministic fallback controller wrapping legacy rule engine and IDM physics.
Activated whenever the AI policy is unavailable, uncalibrated, or in fallback mode.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from ..rule_engine import EMERGENCY_TYPES
from ..types import VehicleAgent
from .actions import VehicleAction

if TYPE_CHECKING:
    from ..engine import SimulationEngine


class FallbackPolicy:
    """
    Produces deterministic VehicleAction objects using the legacy IDM and RuleEngine algorithms.
    Acts as the baseline control benchmark and reliable safety fallback.
    """

    def compute_action(self, v: VehicleAgent, engine: SimulationEngine) -> VehicleAction:
        """Computes deterministic fallback action for vehicle `v`."""
        is_emergency = v.type in EMERGENCY_TYPES
        lead_veh = getattr(v, "_current_lead_veh", None)
        lead_dist = getattr(v, "_current_lead_dist", 999.0)

        # 1. Target Speed calculation via RuleEngine presets
        neighbors = engine.v2v_manager.get_neighbor_info(v, engine.vehicles)
        nearby_inc = v.active_incident_detected is not None
        engine.rule_engine.execute_vehicle_tick(v, neighbors, nearby_inc)

        # 2. Desired acceleration via IDM
        v0 = max(1.0, v.target_speed)
        v_curr = v.speed
        a_max = 3.5 if is_emergency else 2.2
        b_comf = 3.2 if is_emergency else 2.0
        s0 = 2.0 if getattr(v, "is_platoon_follower", False) else 3.5
        T = 0.6 if getattr(v, "is_platoon_follower", False) else 1.3

        delta_v = (v_curr - lead_veh.speed) if lead_veh is not None else 0.0
        s_star = s0 + max(0.0, v_curr * T + (v_curr * delta_v) / (2.0 * math.sqrt(a_max * b_comf)))
        s_actual = max(0.5, lead_dist)

        free_term = 1.0 - (v_curr / v0) ** 4
        inter_term = (s_star / s_actual) ** 2 if lead_veh is not None and lead_dist < 40.0 else 0.0
        raw_accel = a_max * (free_term - inter_term)

        # 3. Tactical lane / corridor intent
        lane_intent = 0
        if not is_emergency and v.is_yielding_to_emergency:
            lane_intent = 1  # Pull to shoulder

        # 4. Route choice
        route_choice = 0
        if v.active_incident_detected is not None and not is_emergency:
            route_choice = 1  # Detour around incident

        # 5. V2V message
        v2v_msg = 0
        if is_emergency:
            v2v_msg = 3  # Emergency corridor clear request
        elif getattr(v, "hazard_lights_active", False):
            v2v_msg = 1  # Hazard alert
        elif getattr(v, "is_platoon_follower", False):
            v2v_msg = 2  # Platoon sync

        # 6. Intersection intent
        inter_intent = 0
        if v.status in ("stopped", "yielding"):
            inter_intent = 2

        action = VehicleAction(
            accel=float(max(-5.0, min(3.5, raw_accel))),
            lane_intent=lane_intent,
            route_choice=route_choice,
            v2v_message=v2v_msg,
            intersection_intent=inter_intent,
            applied_by="fallback",
        )
        return action
