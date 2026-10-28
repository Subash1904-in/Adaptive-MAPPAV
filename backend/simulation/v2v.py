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
Vehicle-to-Vehicle (V2V) and Vehicle-to-Infrastructure (V2I) communication system.
Computes active communication links, message routing, packets/sec rate,
and neighbor spatial graphs.
"""

from __future__ import annotations

import math
import time
import uuid
from typing import List

from .rule_engine import EMERGENCY_TYPES
from .types import V2VJournalEntry, V2VLink, VehicleAgent

V2V_RANGE = 45.0  # meters - maximum direct DSRC/C-V2X communication range


class V2VManager:
    """Manages multi-agent mesh communication, packet rate tracking, and link generation."""

    def __init__(self) -> None:
        self.total_packets_sent: int = 0
        self.packets_per_sec: float = 0.0
        self._packet_count_window: int = 0
        self._window_start: float = time.monotonic()

    def update_neighbor_lists(self, vehicles: list[VehicleAgent]) -> None:
        """Populates v2v_neighbors ID list on each vehicle based on distance <= V2V_RANGE."""
        for v in vehicles:
            v.v2v_neighbors = []

        n = len(vehicles)
        for i in range(n):
            v1 = vehicles[i]
            for j in range(i + 1, n):
                v2 = vehicles[j]
                dist = math.hypot(v1.x - v2.x, v1.z - v2.z)
                if dist <= V2V_RANGE:
                    v1.v2v_neighbors.append(v2.id)
                    v2.v2v_neighbors.append(v1.id)

    def get_neighbor_info(self, vehicle: VehicleAgent, all_vehicles: list[VehicleAgent]) -> list[dict]:
        """Returns neighbor descriptors for the rule engine: [{'id', 'type', 'distance', 'speed'}]."""
        descriptors = []
        for other in all_vehicles:
            if other.id == vehicle.id:
                continue
            dist = math.hypot(vehicle.x - other.x, vehicle.z - other.z)
            if dist <= V2V_RANGE:
                descriptors.append({
                    "id": other.id,
                    "type": other.type,
                    "distance": round(dist, 1),
                    "speed": other.speed * 3.6,  # km/h
                })
        return descriptors

    def compute_neighbor_pairs(self, vehicles: list[VehicleAgent]) -> list[V2VLink]:
        """
        Computes active visual communication links between pairs within range.
        Determines semantic message type (emergency_clear, traffic_jam_cascade, etc.).
        """
        links: list[V2VLink] = []
        n = len(vehicles)
        now = time.time()

        for i in range(n):
            v1 = vehicles[i]
            for j in range(i + 1, n):
                v2 = vehicles[j]
                dist = math.hypot(v1.x - v2.x, v1.z - v2.z)
                if dist > V2V_RANGE:
                    continue

                msg_type = self._infer_message_type(v1, v2)
                links.append(
                    V2VLink(
                        from_id=v1.id,
                        to_id=v2.id,
                        from_x=v1.x,
                        from_z=v1.z,
                        to_x=v2.x,
                        to_z=v2.z,
                        message_type=msg_type,
                        timestamp=now,
                    )
                )
                self._record_packet()

        return links

    def _infer_message_type(self, v1: VehicleAgent, v2: VehicleAgent) -> str:
        """Determines the dominant communication protocol between two vehicles."""
        v1_em = v1.type in EMERGENCY_TYPES
        v2_em = v2.type in EMERGENCY_TYPES

        if v1_em or v2_em:
            if v1.approaching_node_id or v2.approaching_node_id:
                return "signal_preemption"
            return "emergency_clear"

        if v1.status == "rerouting" or v2.status == "rerouting":
            if v1.active_incident_detected or v2.active_incident_detected:
                return "traffic_jam_cascade"
            return "hazard_alert"

        if v1.status == "yielding" or v2.status == "yielding":
            return "v2p_yield"

        if v1.is_inside_intersection_box or v2.is_inside_intersection_box:
            return "intersection_lock"

        return "platoon_sync"

    def _record_packet(self) -> None:
        self._packet_count_window += 1
        now = time.monotonic()
        elapsed = now - self._window_start
        if elapsed >= 1.0:
            self.packets_per_sec = round(self._packet_count_window / elapsed, 1)
            self._packet_count_window = 0
            self._window_start = now
        self.total_packets_sent += 1

    def get_packets_per_sec(self) -> float:
        return self.packets_per_sec

    def links_to_list(self, links: list[V2VLink]) -> list[dict]:
        """Serializes link objects for the React/Three.js frontend."""
        return [
            {
                "fromId": l.from_id,
                "toId": l.to_id,
                "fromX": round(l.from_x, 2),
                "fromZ": round(l.from_z, 2),
                "toX": round(l.to_x, 2),
                "toZ": round(l.to_z, 2),
                "messageType": l.message_type,
                "timestamp": l.timestamp,
            }
            for l in links
        ]
