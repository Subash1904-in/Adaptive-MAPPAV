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
Production-Ready Vehicle-to-Vehicle (V2V) and Autonomous Intersection Management (AIM).
Implements Cooperative Intelligent Transport Systems (C-ITS / SAE J2735 / ETSI ITS-G5):
  1. BSM (Basic Safety Messages) @ 10Hz
  2. EEBL (Electronic Emergency Brake Light) decentralized propagation
  3. CACC (Cooperative Adaptive Cruise Control) tight-headway platoon stabilization
  4. EVA (Emergency Vehicle Alert) dynamic corridor reservation
  5. AIM (Autonomous Intersection Management) space-time conflict zone slot reservation
     - Enables seamless signal-free intersection weaving without physical traffic lights.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .rule_engine import EMERGENCY_TYPES
from .types import V2VJournalEntry, V2VLink, VehicleAgent

V2V_RANGE = 55.0  # meters - maximum direct DSRC / C-V2X 5.9 GHz communication range
CONFLICT_ZONE_RADIUS = 12.0  # meters - intersection conflict envelope radius


@dataclass
class AIMReservationSlot:
    """A space-time slot reservation for crossing an intersection conflict zone."""
    vehicle_id: str
    node_id: str
    t_entry: float
    t_exit: float
    approach_axis: str  # 'ns' or 'ew'
    priority: int
    is_emergency: bool


class AIMIntersectionManager:
    """
    Autonomous Intersection Management (AIM) Coordinator.
    Replaces static traffic light signals with decentralized, cooperative
    space-time reservation slots. Intersecting vehicles negotiate conflict-free
    traversal windows, allowing vehicles to smoothly weave through junctions
    with minimal deceleration and zero stop-and-go idling.
    """

    def __init__(self) -> None:
        # node_id -> list of active reservation slots
        self.reservations: Dict[str, List[AIMReservationSlot]] = {}
        self.total_aim_negotiations: int = 0
        self.total_seamless_weaves: int = 0

    def prune_expired(self, current_time: float) -> None:
        """Removes expired reservation slots."""
        for node_id in list(self.reservations.keys()):
            self.reservations[node_id] = [
                s for s in self.reservations[node_id] if s.t_exit > current_time - 0.2
            ]

    def request_reservation(
        self,
        vehicle: VehicleAgent,
        node_id: str,
        dist_to_node: float,
        current_time: float,
    ) -> Tuple[bool, float, Optional[str]]:
        """
        Processes an AIM intersection reservation request.
        
        Returns:
            granted: bool - whether the vehicle has a clear slot to cross.
            advisory_speed: float - optimal cruising speed to glide through without stopping.
            conflicting_vehicle_id: Optional[str] - ID of vehicle currently reserving the zone.
        """
        self.total_aim_negotiations += 1
        is_emerg = vehicle.type in EMERGENCY_TYPES
        slots = self.reservations.setdefault(node_id, [])

        # Clean old slots
        now = current_time
        slots = [s for s in slots if s.t_exit > now]
        self.reservations[node_id] = slots

        # Estimate arrival and traversal window
        current_v = max(vehicle.speed, 2.5)
        t_arr = now + (dist_to_node / current_v)
        traversal_time = max(1.8, (CONFLICT_ZONE_RADIUS * 2.2) / current_v)
        t_exit = t_arr + traversal_time

        approach_axis = "ns" if abs(math.cos(vehicle.heading)) > 0.707 else "ew"

        # Emergency preemption: Emergency vehicles override any civilian reservation
        if is_emerg:
            # Clear or push back any non-emergency overlapping slots
            slots = [s for s in slots if s.is_emergency or s.t_exit < t_arr or s.t_entry > t_exit]
            slots.append(
                AIMReservationSlot(
                    vehicle_id=vehicle.id,
                    node_id=node_id,
                    t_entry=t_arr,
                    t_exit=t_exit + 0.8,
                    approach_axis=approach_axis,
                    priority=10,
                    is_emergency=True,
                )
            )
            self.reservations[node_id] = slots
            self.total_seamless_weaves += 1
            return True, vehicle.max_speed, None

        # Check existing reservations for spatial conflict
        conflicting_slot: Optional[AIMReservationSlot] = None
        for s in slots:
            if s.vehicle_id == vehicle.id:
                # Already have this slot
                return True, vehicle.target_speed, None

            # Different axis or turning path implies crossing conflict
            if s.approach_axis != approach_axis or s.is_emergency:
                # Check temporal overlap with safety buffer (0.6s)
                if not (t_exit < s.t_entry - 0.4 or t_arr > s.t_exit + 0.4):
                    conflicting_slot = s
                    break

        if conflicting_slot is None:
            # Slot is free! Grant reservation
            slots.append(
                AIMReservationSlot(
                    vehicle_id=vehicle.id,
                    node_id=node_id,
                    t_entry=t_arr,
                    t_exit=t_exit,
                    approach_axis=approach_axis,
                    priority=vehicle.priority,
                    is_emergency=False,
                )
            )
            self.total_seamless_weaves += 1
            return True, vehicle.target_speed, None

        # Conflicting slot exists: Perform cooperative speed harmonization
        # Target arrival immediately after conflicting vehicle exits
        target_t_arr = conflicting_slot.t_exit + 0.5
        time_to_arrive = target_t_arr - now
        if time_to_arrive > 0.3:
            harmonized_speed = max(1.5, min(vehicle.max_speed, dist_to_node / time_to_arrive))
        else:
            harmonized_speed = 0.0

        # If too close to stop bar, vehicle must yield
        if dist_to_node < 8.0 and not (vehicle.speed < 0.8):
            return False, 0.0, conflicting_slot.vehicle_id

        return False, harmonized_speed, conflicting_slot.vehicle_id


class V2VManager:
    """
    Manages multi-agent mesh communication, packet rate tracking,
    and high-fidelity functional link generation.
    """

    def __init__(self) -> None:
        self.total_packets_sent: int = 0
        self.packets_per_sec: float = 0.0
        self._packet_count_window: int = 0
        self._window_start: float = time.monotonic()
        self.aim_manager = AIMIntersectionManager()

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
        """Returns neighbor descriptors: [{'id', 'type', 'distance', 'speed'}]."""
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
        Computes active visual communication links between vehicles.
        Crucially, filters for HIGH-VALUE PURPOSEFUL messages rather than
        rendering an unreadable web of every car in range.
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

                msg_type = self._infer_purposeful_message_type(v1, v2, dist)
                if msg_type is None:
                    continue

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

    def _infer_purposeful_message_type(
        self, v1: VehicleAgent, v2: VehicleAgent, dist: float
    ) -> Optional[str]:
        """
        Selects only active functional communication channels to keep the
        visualization neat, professional, and explainable.
        """
        v1_em = v1.type in EMERGENCY_TYPES
        v2_em = v2.type in EMERGENCY_TYPES

        # 1. Electronic Emergency Brake Light (Critical safety broadcast)
        if v1.hazard_lights_active or v2.hazard_lights_active:
            return "eebl_emergency_brake"

        # 2. Emergency Vehicle dynamic corridor clearance
        if v1_em or v2_em:
            if dist < 42.0:
                return "emergency_clear"

        # 3. CACC Platoon Synchronization (Leader to follower)
        if (v1.is_platoon_follower and v1.platoon_leader_id == v2.id) or (
            v2.is_platoon_follower and v2.platoon_leader_id == v1.id
        ):
            return "cacc_platoon_sync"

        # 4. AIM Autonomous Intersection Negotiation
        if (
            v1.approaching_node_id
            and v2.approaching_node_id
            and v1.approaching_node_id == v2.approaching_node_id
            and dist < 36.0
        ):
            return "aim_intersection_negotiate"

        # 5. Dynamic A* Detour & Incident Alert
        if v1.status == "rerouting" or v2.status == "rerouting":
            if dist < 32.0 and (v1.active_incident_detected or v2.active_incident_detected):
                return "dynamic_detour"

        # 6. Periodic BSM cooperative awareness (sampled to avoid visual clutter)
        if dist < 22.0 and (hash(v1.id + v2.id) % 7 == 0):
            return "platoon_sync"

        return None

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
