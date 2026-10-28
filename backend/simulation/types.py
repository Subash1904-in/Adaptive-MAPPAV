# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Shared data-model dataclasses for the AMAPP simulation backend.

These mirror the TypeScript interfaces in ``src/types/simulation.ts`` so that
the Django REST layer can serialise and deserialise simulation state without
any direct dependency on the Three.js front-end.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


# ---------------------------------------------------------------------------
# Primitive geometry
# ---------------------------------------------------------------------------


@dataclass
class Vector2D:
    """A 2-D point or vector in the XZ plane (Y is the vertical axis)."""

    x: float
    z: float

    def to_dict(self) -> dict:
        """Return a JSON-serialisable dict."""
        return {"x": self.x, "z": self.z}


# ---------------------------------------------------------------------------
# Traffic signal types
# ---------------------------------------------------------------------------

SignalLightColor = str  # 'green' | 'yellow' | 'red'


@dataclass
class OccupancySensorState:
    """State reported by a virtual loop-detector at an approach lane."""

    occupied: bool = False
    vehicle_count: int = 0
    lead_dist: float = 0.0
    hold_active: bool = False

    def to_dict(self) -> dict:
        return {
            "occupied": self.occupied,
            "vehicle_count": self.vehicle_count,
            "lead_dist": self.lead_dist,
            "hold_active": self.hold_active,
        }


@dataclass
class IntersectionTrafficLight:
    """
    Full traffic-light state for a single intersection node.

    The cycle is strictly 52 seconds, split across up to 6 named phases.
    Emergency override fields allow a pre-emption controller to hold a
    specific axis green for emergency vehicles.
    """

    ns_state: SignalLightColor = "green"
    ew_state: SignalLightColor = "red"
    timer: float = 0.0
    cycle_duration: float = 52.0  # Must remain 52.0 s
    phase_index: int = 1          # 1–6
    phase_name: str = "North-South Green"
    phase_time_remaining: float = 20.0
    emergency_override_axis: Optional[str] = None   # 'ns' | 'ew' | None
    emergency_override_timer: float = 0.0
    ns_occupancy: Optional[OccupancySensorState] = None
    ew_occupancy: Optional[OccupancySensorState] = None

    def __getitem__(self, key: str):
        return getattr(self, key)

    def __setitem__(self, key: str, value) -> None:
        setattr(self, key, value)

    def get(self, key: str, default=None):
        return getattr(self, key, default)

    def to_dict(self) -> dict:
        return {
            "ns_state": self.ns_state,
            "ew_state": self.ew_state,
            "timer": self.timer,
            "cycle_duration": self.cycle_duration,
            "phase_index": self.phase_index,
            "phase_name": self.phase_name,
            "phase_time_remaining": self.phase_time_remaining,
            "emergency_override_axis": self.emergency_override_axis,
            "emergency_override_timer": self.emergency_override_timer,
            "ns_occupancy": self.ns_occupancy.to_dict() if self.ns_occupancy else None,
            "ew_occupancy": self.ew_occupancy.to_dict() if self.ew_occupancy else None,
        }


# ---------------------------------------------------------------------------
# Map graph types
# ---------------------------------------------------------------------------


@dataclass
class MapNode:
    """
    A graph node representing an intersection (or curve/terminal point) in
    the city road network.

    Attributes:
        id:                 Unique identifier, e.g. ``"n_2_3"``.
        x:                  World-space X coordinate in metres.
        z:                  World-space Z coordinate in metres.
        node_type:          One of ``'intersection'``, ``'curve'``, or
                            ``'terminal'``.
        connected_node_ids: IDs of directly reachable neighbour nodes.
        traffic_light:      Traffic-light state; present only on intersection
                            nodes.
    """

    id: str
    x: float
    z: float
    node_type: str = "intersection"  # 'intersection' | 'curve' | 'terminal'
    connected_node_ids: List[str] = field(default_factory=list)
    traffic_light: Optional[IntersectionTrafficLight] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "x": self.x,
            "z": self.z,
            "node_type": self.node_type,
            "connected_node_ids": list(self.connected_node_ids),
            "traffic_light": self.traffic_light.to_dict() if self.traffic_light else None,
        }


@dataclass
class RoadSegment:
    """
    A directed edge in the road-network graph connecting two MapNodes.

    Each physical road generates *two* RoadSegment objects (one in each
    direction) to support per-direction vehicle counts and blockage flags.

    Attributes:
        id:                   Unique identifier, e.g.
                              ``"road_n_0_0_n_1_0"``.
        from_node_id:         Source node ID.
        to_node_id:           Destination node ID.
        lanes:                Number of traffic lanes in this direction.
        length:               Segment length in metres.
        speed_limit:          Maximum legal speed in m/s.
        capacity:             Jam capacity (max vehicles before full
                              congestion).
        current_vehicle_count: Live count of vehicles on this segment.
        is_blocked:           Hard blockage flag (incident or manual).
        incident_id:          ID of the causative incident, if any.
        waypoints:            Ordered list of intermediate guide-points for
                              vehicle steering (JSON dicts ``{x, z}``).
    """

    id: str
    from_node_id: str
    to_node_id: str
    lanes: int = 3
    length: float = 75.0
    speed_limit: float = 50.0 / 3.6  # ≈ 13.89 m/s
    capacity: int = 20
    current_vehicle_count: int = 0
    is_blocked: bool = False
    incident_id: Optional[str] = None
    waypoints: List[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "from_node_id": self.from_node_id,
            "to_node_id": self.to_node_id,
            "lanes": self.lanes,
            "length": self.length,
            "speed_limit": self.speed_limit,
            "capacity": self.capacity,
            "current_vehicle_count": self.current_vehicle_count,
            "is_blocked": self.is_blocked,
            "incident_id": self.incident_id,
            "waypoints": list(self.waypoints),
        }


# ---------------------------------------------------------------------------
# Incident type
# ---------------------------------------------------------------------------


@dataclass
class Incident:
    """
    An active traffic incident placed somewhere in the simulation world.

    Attributes:
        id:               Unique identifier.
        incident_type:    One of ``'roadblock'``, ``'accident'``,
                          ``'traffic_jam'``, ``'construction'``, or
                          ``'hazard'``.
        x:                World-space X coordinate of the incident centre.
        z:                World-space Z coordinate of the incident centre.
        radius:           Effective influence radius in metres.
        label:            Human-readable label shown in the UI.
        timestamp:        Unix epoch timestamp (ms) when the incident started.
        affects_road_ids: IDs of road segments directly affected.
        severity:         Optional severity score (0.0–1.0).
    """

    id: str
    incident_type: str = "roadblock"  # 'roadblock'|'accident'|'traffic_jam'|'construction'|'hazard'
    x: float = 0.0
    z: float = 0.0
    radius: float = 10.0
    label: str = ""
    timestamp: float = 0.0
    affects_road_ids: List[str] = field(default_factory=list)
    severity: Optional[float] = None
    type: Optional[str] = None

    def __post_init__(self):
        if self.type is not None:
            self.incident_type = self.type
        else:
            self.type = self.incident_type

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.incident_type,
            "incident_type": self.incident_type,
            "x": self.x,
            "z": self.z,
            "radius": self.radius,
            "label": self.label,
            "timestamp": self.timestamp,
            "affects_road_ids": list(self.affects_road_ids),
            "severity": self.severity,
        }


# ---------------------------------------------------------------------------
# V2V journal & bubble types
# ---------------------------------------------------------------------------


@dataclass
class V2VJournalEntry:
    """
    One entry in a vehicle's V2V communication journal.

    Attributes:
        id:                  Unique entry ID (e.g. ``"j_a3f9c2"``).
        timestamp:           Wall-clock HH:MM:SS string for the dashboard log.
        direction:           ``'TX'`` for transmitted, ``'RX'`` for received.
        counterpart_id:      Peer vehicle / infrastructure node ID.
        type:                V2V message type (e.g. ``'EMERGENCY_CLEAR'``).
        content:             Human-readable message description.
        negotiated_action:   Resolved behaviour string shown in the UI.
    """

    id: str
    timestamp: str
    direction: str       # 'TX' | 'RX'
    counterpart_id: str
    type: str            # one of the V2VJournalEntryType literals
    content: str
    negotiated_action: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "direction": self.direction,
            "counterpart_id": self.counterpart_id,
            "type": self.type,
            "content": self.content,
            "negotiated_action": self.negotiated_action,
        }


@dataclass
class V2VBubble:
    """
    Overhead text bubble emitted above a vehicle for a significant V2V event.
    Used by the frontend to render transient annotation overlays.

    Attributes:
        id:         Unique bubble ID.
        vehicle_id: The vehicle this bubble floats above.
        type:       V2V event type key.
        text:       Display string (may include emoji).
        x:          Vehicle world-space X at time of emission.
        z:          Vehicle world-space Z at time of emission.
        timestamp:  Unix epoch (seconds) when the bubble was created.
    """

    id: str
    vehicle_id: str
    type: str
    text: str
    x: float
    z: float
    timestamp: float

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "vehicle_id": self.vehicle_id,
            "type": self.type,
            "text": self.text,
            "x": round(self.x, 2),
            "z": round(self.z, 2),
            "timestamp": self.timestamp,
        }


@dataclass
class V2VLink:
    """
    A directed V2V communication link rendered as a coloured line between
    two vehicles in the scene.

    Attributes:
        from_id:      Source vehicle ID.
        to_id:        Destination vehicle ID.
        from_x:       Source world-space X.
        from_z:       Source world-space Z.
        to_x:         Destination world-space X.
        to_z:         Destination world-space Z.
        message_type: V2V message type that determines line colour.
        timestamp:    Unix epoch (seconds) when the link was recorded.
    """

    from_id: str
    to_id: str
    from_x: float
    from_z: float
    to_x: float
    to_z: float
    message_type: str   # one of the V2VMessageType literals
    timestamp: float

    def to_dict(self) -> dict:
        return {
            "from_id": self.from_id,
            "to_id": self.to_id,
            "from_x": round(self.from_x, 2),
            "from_z": round(self.from_z, 2),
            "to_x": round(self.to_x, 2),
            "to_z": round(self.to_z, 2),
            "message_type": self.message_type,
        }


# ---------------------------------------------------------------------------
# Pedestrian agent
# ---------------------------------------------------------------------------


@dataclass
class PedestrianAgent:
    """
    Autonomous pedestrian entity navigating the sidewalk grid.

    Pedestrians move between random sidewalk waypoints at walking speed
    (1.2 – 1.7 m/s).  When ``is_crossing_crosswalk`` is ``True``, any
    non-emergency vehicle within 9.5 m will apply V2P crosswalk yield logic.

    Attributes:
        id:                   Unique pedestrian ID (e.g. ``"ped_a3f9c"``).
        x:                    Current world-space X position.
        z:                    Current world-space Z position.
        target_x:             Target waypoint X.
        target_z:             Target waypoint Z.
        speed:                Walking speed in m/s.
        heading:              Movement heading in radians (atan2 XZ plane).
        status:               ``'walking'`` | ``'waiting_curb'`` | ``'crossing'``
        is_crossing_crosswalk: Whether this pedestrian is in an active road
                              crossing and may trigger V2P yields.
        crosswalk_node_id:    Optional map node ID of the nearest crosswalk.
        color:                Hex shirt colour for 3-D mesh tinting.
        leg_angle:            Accumulated angle for walking-stride animation
                              (radians; wraps via modulo in serialisation).
    """

    id: str
    x: float
    z: float
    target_x: float
    target_z: float
    speed: float                           # m/s  (1.2 – 1.7)
    heading: float                         # radians
    status: str = "walking"               # 'walking' | 'waiting_curb' | 'crossing'
    is_crossing_crosswalk: bool = False
    crosswalk_node_id: Optional[str] = None
    color: str = "#0284c7"
    leg_angle: float = 0.0

    def to_dict(self) -> dict:
        import math
        return {
            "id": self.id,
            "x": round(self.x, 2),
            "z": round(self.z, 2),
            "heading": round(self.heading, 3),
            "status": self.status,
            "is_crossing_crosswalk": self.is_crossing_crosswalk,
            "color": self.color,
            "leg_angle": round(self.leg_angle % (2 * math.pi), 3),
        }


# ---------------------------------------------------------------------------
# Vehicle agent
# ---------------------------------------------------------------------------


@dataclass
class VehicleAgent:
    """
    Full autonomous vehicle agent state — the core entity of the AMAPP
    simulation.

    Fields map 1-to-1 to the TypeScript ``VehicleAgent`` interface in
    ``src/types/simulation.ts``, translated to Python snake_case.

    Physics, routing, V2V communication journal, lateral corridor kinematics,
    and intersection box management are all encapsulated here so that the
    ``SimulationEngine`` can treat the agent as a plain data record.
    """

    id: str
    type: str                              # VehicleType literal
    x: float
    z: float
    heading: float                         # radians
    speed: float                           # m/s
    target_speed: float
    max_speed: float
    acceleration: float                    # m/s²
    acceleration_g: float = 0.1           # fraction of g
    status: str = "cruising"              # VehicleStatus literal
    priority: int = 5                      # 1 – 10
    color: str = "#0284c7"
    current_node_id: str = ""
    target_node_id: str = ""
    path: List[dict] = field(default_factory=list)   # [{x, z}, …]
    path_node_ids: List[str] = field(default_factory=list)
    path_index: int = 0
    v2v_neighbors: List[str] = field(default_factory=list)
    avoidance_radius: float = 6.0
    wait_time: float = 0.0
    distance_traveled: float = 0.0
    reroute_count: int = 0
    active_incident_detected: Optional[str] = None
    path_efficiency: float = 80.0          # 0 – 100 %
    active_lua_rule: str = "Adaptive Platoon Following"
    siren_active: bool = False
    v2v_journal: List[V2VJournalEntry] = field(default_factory=list)
    jam_cascade_received_time: Optional[float] = None
    cascade_hop_count: Optional[int] = None
    lateral_offset: float = 0.0            # metres from lane centreline
    target_lateral_offset: float = 0.0
    is_yielding_to_emergency: bool = False
    emergency_clearance_timer: float = 0.0
    is_inside_intersection_box: bool = False
    box_clearance_priority: bool = False
    box_clearance_timer: float = 0.0
    approaching_node_id: Optional[str] = None
    platoon_leader_id: Optional[str] = None
    is_platoon_follower: bool = False
    hazard_lights_active: bool = False
    last_reroute_evaluation_time: float = 0.0
    overtake_state: str = "none"           # 'none' | 'pulling_out' | 'passing' | 'returning'
    overtake_timer: float = 0.0
    ttc: Optional[float] = None            # Time-To-Collision in seconds

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "x": round(self.x, 2),
            "z": round(self.z, 2),
            "heading": round(self.heading, 3),
            "speed": round(self.speed, 2),
            "speed_kmh": round(self.speed * 3.6, 1),
            "target_speed": round(self.target_speed, 2),
            "status": self.status,
            "priority": self.priority,
            "color": self.color,
            "current_node_id": self.current_node_id,
            "target_node_id": self.target_node_id,
            "path_index": self.path_index,
            "v2v_neighbors": list(self.v2v_neighbors),
            "wait_time": round(self.wait_time, 2),
            "distance_traveled": round(self.distance_traveled, 1),
            "reroute_count": self.reroute_count,
            "active_incident_detected": self.active_incident_detected,
            "path_efficiency": round(self.path_efficiency, 1),
            "active_lua_rule": self.active_lua_rule,
            "siren_active": self.siren_active,
            "acceleration_g": self.acceleration_g,
            "lateral_offset": round(self.lateral_offset, 3),
            "is_yielding_to_emergency": self.is_yielding_to_emergency,
            "is_inside_intersection_box": self.is_inside_intersection_box,
            "box_clearance_priority": self.box_clearance_priority,
            "approaching_node_id": self.approaching_node_id,
            "platoon_leader_id": self.platoon_leader_id,
            "is_platoon_follower": self.is_platoon_follower,
            "hazard_lights_active": self.hazard_lights_active,
            "ttc": round(self.ttc, 2) if self.ttc is not None else None,
            "v2v_journal": [e.to_dict() for e in self.v2v_journal[:5]],
        }
