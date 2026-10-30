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
Production-Ready Pedestrian Simulation and Crosswalk Safety System.
Enforces that pedestrians navigate strictly along sidewalks, stop and wait
at crosswalk curbs when vehicles are approaching, and cross safely only when
the roadway is clear or vehicles have stopped to yield.
"""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .types import PedestrianAgent, VehicleAgent

CASUAL_COLORS = ["#0284c7", "#16a34a", "#ea580c", "#e11d48", "#4f46e5", "#334155"]


@dataclass
class CrosswalkZone:
    id: str
    node_id: str
    axis: str  # 'ns' or 'ew'
    curb_a: Tuple[float, float]
    curb_b: Tuple[float, float]
    road_center: Tuple[float, float]


class PedestrianManager:
    """Manages autonomous pedestrian agents, sidewalk routing, and zebra crosswalk yielding."""

    def __init__(self, city, count: int = 32, seed: int | None = None) -> None:
        self._random = random.Random(seed)
        self.pedestrians: list[PedestrianAgent] = []
        self.crosswalks: list[CrosswalkZone] = []
        self._sidewalk_points: list[Tuple[float, float]] = []
        self._base_speeds: Dict[str, float] = {}
        self._crosswalk_targets: Dict[str, Optional[CrosswalkZone]] = {}

        self._build_network(city)
        self._spawn_pedestrians(count)

    def _build_network(self, city) -> None:
        curb_offset = 9.2
        zebra_dist = 10.5

        for node in city.nodes.values():
            # North crosswalk
            self.crosswalks.append(
                CrosswalkZone(
                    id=f"cw_n_{node.id}",
                    node_id=node.id,
                    axis="ns",
                    curb_a=(node.x - curb_offset, node.z - zebra_dist),
                    curb_b=(node.x + curb_offset, node.z - zebra_dist),
                    road_center=(node.x, node.z - zebra_dist),
                )
            )
            # South crosswalk
            self.crosswalks.append(
                CrosswalkZone(
                    id=f"cw_s_{node.id}",
                    node_id=node.id,
                    axis="ns",
                    curb_a=(node.x - curb_offset, node.z + zebra_dist),
                    curb_b=(node.x + curb_offset, node.z + zebra_dist),
                    road_center=(node.x, node.z + zebra_dist),
                )
            )
            # West crosswalk
            self.crosswalks.append(
                CrosswalkZone(
                    id=f"cw_w_{node.id}",
                    node_id=node.id,
                    axis="ew",
                    curb_a=(node.x - zebra_dist, node.z - curb_offset),
                    curb_b=(node.x - zebra_dist, node.z + curb_offset),
                    road_center=(node.x - zebra_dist, node.z),
                )
            )
            # East crosswalk
            self.crosswalks.append(
                CrosswalkZone(
                    id=f"cw_e_{node.id}",
                    node_id=node.id,
                    axis="ew",
                    curb_a=(node.x + zebra_dist, node.z - curb_offset),
                    curb_b=(node.x + zebra_dist, node.z + curb_offset),
                    road_center=(node.x + zebra_dist, node.z),
                )
            )

        for cw in self.crosswalks:
            self._sidewalk_points.append(cw.curb_a)
            self._sidewalk_points.append(cw.curb_b)

    def _spawn_pedestrians(self, count: int) -> None:
        if not self._sidewalk_points:
            return

        for _ in range(count):
            start_x, start_z = self._random.choice(self._sidewalk_points)
            target_x, target_z = self._random.choice(self._sidewalk_points)
            color = self._random.choice(CASUAL_COLORS)
            base_speed = round(self._random.uniform(1.25, 1.70), 2)
            pid = f"ped_{uuid.uuid4().hex[:6]}"

            self._base_speeds[pid] = base_speed
            self._crosswalk_targets[pid] = None

            self.pedestrians.append(
                PedestrianAgent(
                    id=pid,
                    x=start_x + (self._random.random() - 0.5) * 0.8,
                    z=start_z + (self._random.random() - 0.5) * 0.8,
                    target_x=target_x,
                    target_z=target_z,
                    speed=base_speed,
                    heading=0.0,
                    status="walking",
                    is_crossing_crosswalk=False,
                    color=color,
                    leg_angle=self._random.uniform(0, 6.28),
                )
            )

    def _is_vehicle_approaching(
        self, cw: CrosswalkZone, vehicles: list[VehicleAgent]
    ) -> bool:
        """Determines if an oncoming vehicle is moving fast towards this crosswalk."""
        for v in vehicles:
            if v.speed < 0.6:
                continue

            if cw.axis == "ns":
                dx = abs(v.x - cw.road_center[0])
                if dx > 7.0:
                    continue
                dz = cw.road_center[1] - v.z
                heading_z = math.cos(v.heading)
                is_heading_toward = (dz * heading_z) > 0
                dist = abs(dz)
                if is_heading_toward and dist < 24.0 and v.speed > 1.6:
                    return True
            else:
                dz = abs(v.z - cw.road_center[1])
                if dz > 7.0:
                    continue
                dx = cw.road_center[0] - v.x
                heading_x = math.sin(v.heading)
                is_heading_toward = (dx * heading_x) > 0
                dist = abs(dx)
                if is_heading_toward and dist < 24.0 and v.speed > 1.6:
                    return True

        return False

    def get_pedestrian_in_path(
        self, vx: float, vz: float, v_heading: float, v_speed: float
    ) -> Optional[PedestrianAgent]:
        """Detects whether a pedestrian is on the roadway directly ahead of a vehicle."""
        forward_x = math.sin(v_heading)
        forward_z = math.cos(v_heading)
        right_x = math.cos(v_heading)
        right_z = -math.sin(v_heading)

        for p in self.pedestrians:
            dx = p.x - vx
            dz = p.z - vz
            forward_dist = dx * forward_x + dz * forward_z
            lateral_dist = abs(dx * right_x + dz * right_z)

            # 1. Crossing pedestrian in vehicle travel path
            if p.is_crossing_crosswalk:
                if 0.5 < forward_dist < 20.0 and lateral_dist < 5.8:
                    return p

            # 2. Waiting curb pedestrian at upcoming zebra
            if p.status == "waiting_curb":
                if 2.0 < forward_dist < 16.0 and lateral_dist < 8.5:
                    return p

            # 3. Emergency close-range bumper envelope
            if -0.5 < forward_dist < 6.5 and lateral_dist < 3.2:
                return p

        return None

    def update(self, dt: float, vehicles: Optional[list[VehicleAgent]] = None) -> None:
        if vehicles is None:
            vehicles = []

        dt = max(dt, 0.0)

        for p in self.pedestrians:
            base_speed = self._base_speeds.get(p.id, 1.4)
            dx = p.target_x - p.x
            dz = p.target_z - p.z
            dist = math.hypot(dx, dz)

            # Arrived at waypoint
            if dist < 1.2:
                if p.status == "crossing":
                    # Finished crossing!
                    p.status = "walking"
                    p.is_crossing_crosswalk = False
                    self._crosswalk_targets[p.id] = None
                    nx, nz = self._random.choice(self._sidewalk_points)
                    p.target_x = nx
                    p.target_z = nz
                    p.speed = base_speed
                else:
                    # Decide whether to cross a nearby zebra
                    target_cw: Optional[CrosswalkZone] = None
                    if self._random.random() < 0.45:
                        for cw in self.crosswalks:
                            da = math.hypot(cw.curb_a[0] - p.x, cw.curb_a[1] - p.z)
                            db = math.hypot(cw.curb_b[0] - p.x, cw.curb_b[1] - p.z)
                            if da < 3.5:
                                target_cw = cw
                                p.target_x, p.target_z = cw.curb_b
                                break
                            elif db < 3.5:
                                target_cw = cw
                                p.target_x, p.target_z = cw.curb_a
                                break

                    if target_cw:
                        self._crosswalk_targets[p.id] = target_cw
                        p.status = "waiting_curb"
                        p.speed = 0.0
                        p.is_crossing_crosswalk = False
                    else:
                        nx, nz = self._random.choice(self._sidewalk_points)
                        p.target_x = nx
                        p.target_z = nz
                        p.status = "walking"
                        p.speed = base_speed
                        p.is_crossing_crosswalk = False

            # Curb waiting evaluation
            if p.status == "waiting_curb":
                cw = self._crosswalk_targets.get(p.id)
                has_car_coming = self._is_vehicle_approaching(cw, vehicles) if cw else False
                if has_car_coming:
                    p.speed = 0.0
                    p.is_crossing_crosswalk = False
                else:
                    p.status = "crossing"
                    p.is_crossing_crosswalk = True
                    p.speed = base_speed

            # Kinematics
            if p.speed > 0.05:
                p.heading = math.atan2(dx, dz)
                step = min(dist, p.speed * dt)
                p.x += math.sin(p.heading) * step
                p.z += math.cos(p.heading) * step
                stride_rate = 10.0 if p.status == "crossing" else 7.5
                p.leg_angle = (p.leg_angle + dt * stride_rate) % (2 * math.pi)

    def is_pedestrian_crossing_near(self, x: float, z: float, radius: float = 9.5) -> bool:
        return any(
            p.is_crossing_crosswalk and math.hypot(p.x - x, p.z - z) < radius
            for p in self.pedestrians
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
