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

"""Pedestrian movement for the server-side simulation."""

from __future__ import annotations

import math
import random
import uuid

from .types import PedestrianAgent

CASUAL_COLORS = ["#0284c7", "#16a34a", "#ea580c", "#e11d48", "#4f46e5", "#334155"]


class PedestrianManager:
    """Moves pedestrians between deterministic sidewalk/crosswalk points."""

    def __init__(self, city, count: int = 32, seed: int | None = None) -> None:
        self._random = random.Random(seed)
        self.pedestrians: list[PedestrianAgent] = []
        self._points = [
            (node.x + offset_x, node.z + offset_z)
            for node in city.nodes.values()
            for offset_x, offset_z in ((-9.0, -9.0), (9.0, -9.0), (-9.0, 9.0), (9.0, 9.0))
        ]
        for _ in range(count):
            if not self._points:
                break
            x, z = self._random.choice(self._points)
            tx, tz = self._random.choice(self._points)
            color = self._random.choice(CASUAL_COLORS)
            self.pedestrians.append(
                PedestrianAgent(
                    id=f"ped_{uuid.uuid4().hex[:6]}",
                    x=x + (self._random.random() - 0.5) * 3.0,
                    z=z + (self._random.random() - 0.5) * 3.0,
                    target_x=tx,
                    target_z=tz,
                    speed=self._random.uniform(1.2, 1.7),
                    heading=0.0,
                    color=color,
                )
            )

    def update(self, dt: float) -> None:
        for pedestrian in self.pedestrians:
            dx = pedestrian.target_x - pedestrian.x
            dz = pedestrian.target_z - pedestrian.z
            distance = math.hypot(dx, dz)
            if distance < 1.5:
                pedestrian.target_x, pedestrian.target_z = self._random.choice(self._points)
                pedestrian.is_crossing_crosswalk = self._random.random() < 0.35
                pedestrian.status = "crossing" if pedestrian.is_crossing_crosswalk else "walking"
                continue
            pedestrian.heading = math.atan2(dx, dz)
            step = min(distance, pedestrian.speed * max(dt, 0.0))
            pedestrian.x += math.sin(pedestrian.heading) * step
            pedestrian.z += math.cos(pedestrian.heading) * step
            pedestrian.leg_angle = (pedestrian.leg_angle + dt * 8.0) % (2 * math.pi)

    def is_pedestrian_crossing_near(self, x: float, z: float, radius: float = 8.5) -> bool:
        return any(
            pedestrian.is_crossing_crosswalk
            and math.hypot(pedestrian.x - x, pedestrian.z - z) < radius
            for pedestrian in self.pedestrians
        )

    def to_list(self) -> list[dict]:
        """Serializes all pedestrians for WebSocket broadcast."""
        return [
            {
                "id": p.id,
                "x": round(p.x, 2),
                "z": round(p.z, 2),
                "heading": round(p.heading, 3),
                "speed": round(p.speed, 2),
                "status": p.status,
                "isCrossingCrosswalk": p.is_crossing_crosswalk,
                "color": p.color,
                "legAngle": round(p.leg_angle, 3),
            }
            for p in self.pedestrians
        ]
