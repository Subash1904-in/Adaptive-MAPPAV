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
Deterministic safety shield for autonomous vehicle actions.
Guarantees physical safety invariants without overriding valid AI driving maneuvers.
Records all interventions for safety auditing and telemetry.
"""

from __future__ import annotations

import math
import time
from collections import deque
from typing import Dict, List, TYPE_CHECKING

from ..rule_engine import EMERGENCY_TYPES
from ..types import VehicleAgent
from .actions import VehicleAction

if TYPE_CHECKING:
    from ..engine import SimulationEngine


class SafetyShield:
    """
    Enforces essential physical constraints:
    1. Anti-collision braking when TTC < 1.0s or gap < 4.0m.
    2. Red-light stop-bar compliance outside intersection box.
    3. Pedestrian crosswalk hard-stop.
    4. Roadblock and barrier collision avoidance.
    """

    def __init__(self, max_history: int = 150) -> None:
        self.total_interventions = 0
        self.interventions_by_type: Dict[str, int] = {
            "COLLISION_AVOIDANCE": 0,
            "RED_LIGHT_COMPLIANCE": 0,
            "PEDESTRIAN_PROTECTION": 0,
            "ROADBLOCK_BARRIER": 0,
            "TRACTION_CLAMP": 0,
        }
        self.recent_interventions: deque = deque(maxlen=max_history)

    def verify_and_correct(
        self,
        v: VehicleAgent,
        requested_action: VehicleAction,
        engine: SimulationEngine,
    ) -> VehicleAction:
        """
        Validates `requested_action`. If safe, passes it through untouched (`applied_by='ai'`).
        If an invariant would be breached, minimally adjusts the action and logs the intervention.
        """
        safe_action = VehicleAction(
            accel=requested_action.accel,
            lane_intent=requested_action.lane_intent,
            route_choice=requested_action.route_choice,
            v2v_message=requested_action.v2v_message,
            intersection_intent=requested_action.intersection_intent,
            applied_by="ai",
        )

        is_emergency = v.type in EMERGENCY_TYPES
        lead_dist = getattr(v, "_current_lead_dist", 999.0)
        ttc = getattr(v, "ttc", None)

        # 1. Anti-Collision TTC & Bumper Invariant
        # If imminent collision is projected within 1.0s or bumper gap < 4.0m with positive closing speed
        if (ttc is not None and ttc < 1.0 and lead_dist < 18.0) or (lead_dist < 4.2 and v.speed > 0.5):
            if safe_action.accel > -3.5:
                safe_action.accel = -5.0
                safe_action.applied_by = "shield"
                self._record(v.id, "COLLISION_AVOIDANCE", "Imminent collision projected (TTC < 1.0s or bumper gap critical)")

        # 2. Red-Light Stop-Bar Invariant
        if not is_emergency and not v.is_inside_intersection_box:
            for node in engine.city.nodes.values():
                if node.traffic_light:
                    d = math.hypot(node.x - v.x, node.z - v.z)
                    if d < 14.0:
                        is_ns = abs(math.cos(v.heading)) > abs(math.sin(v.heading))
                        color = node.traffic_light.ns_state if is_ns else node.traffic_light.ew_state
                        if color in ("red", "yellow") and d > 3.5:
                            # Stop line is ahead; must not accelerate into intersection on red
                            if safe_action.accel > -1.5 and v.speed > 1.0:
                                safe_action.accel = -3.8
                                safe_action.intersection_intent = 2  # stop
                                safe_action.applied_by = "shield"
                                self._record(v.id, "RED_LIGHT_COMPLIANCE", "Red signal stop-bar compliance enforced")
                                break

        # 3. Pedestrian Crosswalk Invariant
        if engine.pedestrian_manager.is_pedestrian_crossing_near(v.x, v.z, radius=7.0):
            if v.speed > 1.2 and safe_action.accel > -2.0:
                safe_action.accel = -4.5
                safe_action.applied_by = "shield"
                self._record(v.id, "PEDESTRIAN_PROTECTION", "Pedestrian crossing active in immediate vehicle trajectory")

        # 4. Roadblock Incident Invariant
        for inc in engine.incidents:
            if inc.type in ("roadblock", "accident"):
                idist = math.hypot(inc.x - v.x, inc.z - v.z)
                if idist < inc.radius + 6.0:
                    fwd = math.sin(v.heading) * (inc.x - v.x) + math.cos(v.heading) * (inc.z - v.z)
                    if fwd > 0 and v.speed > 2.0 and safe_action.accel > -2.5:
                        safe_action.accel = -4.0
                        safe_action.applied_by = "shield"
                        self._record(v.id, "ROADBLOCK_BARRIER", "Roadblock or collision hazard ahead")
                        break

        # 5. Physical Traction Clamp
        clamped_accel = max(-6.0, min(3.5, safe_action.accel))
        if clamped_accel != safe_action.accel:
            safe_action.accel = clamped_accel
            safe_action.applied_by = "shield"
            self._record(v.id, "TRACTION_CLAMP", "Acceleration clamped to physical tire traction bounds")

        return safe_action

    def _record(self, vehicle_id: str, intervention_type: str, reason: str) -> None:
        self.total_interventions += 1
        self.interventions_by_type[intervention_type] = (
            self.interventions_by_type.get(intervention_type, 0) + 1
        )
        self.recent_interventions.append({
            "timestamp": time.time(),
            "vehicle_id": vehicle_id,
            "type": intervention_type,
            "reason": reason,
        })

    def get_metrics(self) -> dict:
        return {
            "total_interventions": self.total_interventions,
            "by_type": dict(self.interventions_by_type),
            "recent_count": len(self.recent_interventions),
            "last_intervention": self.recent_interventions[-1] if self.recent_interventions else None,
        }

