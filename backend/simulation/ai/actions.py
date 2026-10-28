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
Vehicle action representation for the Multi-Agent Reinforcement Learning policy.
Combines continuous driving controls with tactical discrete decisions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class VehicleAction:
    """Action produced by an agent policy for a single vehicle."""

    # Continuous longitudinal acceleration in m/s² (bounded to [-4.5, +3.5])
    accel: float = 0.0

    # Tactical lateral lane intent: -1 (shift left), 0 (hold lane), +1 (shift right / shoulder)
    lane_intent: int = 0

    # Route candidate selection: 0 (keep current route), 1 (candidate A), 2 (candidate B)
    route_choice: int = 0

    # V2V coordination broadcast: 0 (silent), 1 (hazard alert), 2 (platoon sync), 3 (emergency request)
    v2v_message: int = 0

    # Intersection negotiation intent: 0 (proceed), 1 (creep cautiously), 2 (stop / yield)
    intersection_intent: int = 0

    # Diagnostic metadata
    raw_logits: Dict[str, Any] | None = None
    applied_by: str = "ai"  # 'ai' | 'shield' | 'fallback'

    def clamp(self) -> VehicleAction:
        """Enforces physical bounds on action components."""
        self.accel = max(-4.5, min(3.5, float(self.accel)))
        self.lane_intent = max(-1, min(1, int(self.lane_intent)))
        self.route_choice = max(0, min(2, int(self.route_choice)))
        self.v2v_message = max(0, min(3, int(self.v2v_message)))
        self.intersection_intent = max(0, min(2, int(self.intersection_intent)))
        return self

    def to_dict(self) -> dict:
        return {
            "accel": round(self.accel, 3),
            "lane_intent": self.lane_intent,
            "route_choice": self.route_choice,
            "v2v_message": self.v2v_message,
            "intersection_intent": self.intersection_intent,
            "applied_by": self.applied_by,
        }
