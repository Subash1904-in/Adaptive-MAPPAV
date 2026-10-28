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
City-map graph layer for the AMAPP simulation backend.

This module is the **data/graph half** of the TypeScript ``cityMap.ts`` file.
All Three.js rendering code remains in the front-end; this module deals only
with the pure graph structure — nodes, road segments, adjacency lists, and
spatial bounds — so that the Django REST API can expose map topology to any
consumer.

Grid layout
-----------
The city is a 5 × 5 grid of intersection nodes spaced 75 m apart, centred on
the world origin::

    ┌──────────────────────────────────┐
    │  n_0_0  n_1_0  n_2_0  n_3_0  n_4_0   z = -150
    │  n_0_1  n_1_1  …                      z =  -75
    │  n_0_2  n_1_2  n_2_2  …               z =    0
    │  n_0_3  …                             z =   75
    │  n_0_4  n_1_4  n_2_4  n_3_4  n_4_4   z =  150
    └──────────────────────────────────┘
      x=-150  x=-75   x=0   x=75  x=150

Node coordinate formula (matches TypeScript front-end exactly)::

    x = (gx - (GRID_SIZE - 1) / 2) * SPACING
    z = (gz - (GRID_SIZE - 1) / 2) * SPACING
    id = f"n_{gx}_{gz}"
"""

from __future__ import annotations

import math
from typing import Dict, List

from .types import IntersectionTrafficLight, MapNode, RoadSegment, Vector2D

# ---------------------------------------------------------------------------
# Grid constants (must match front-end cityMap.ts)
# ---------------------------------------------------------------------------

GRID_SIZE: int = 5          # 5 × 5 = 25 intersection nodes
SPACING: float = 75.0       # metres between adjacent intersections
ROAD_WIDTH: float = 14.0    # metres (visual only; used to compute bounds)
_SPEED_LIMIT: float = 50.0 / 3.6   # 50 km/h → ≈ 13.889 m/s
_LANES: int = 3
_CAPACITY: int = 20

# Stagger constant: 8.667 s apart so that the 25 lights spread across the
# full 52-second cycle without clumping.
_TIMER_STAGGER: float = 8.667


# ---------------------------------------------------------------------------
# Public class
# ---------------------------------------------------------------------------


class CityLayout:
    """
    Pure-Python representation of the procedural 5 × 5 city road network.

    The constructor builds the complete graph synchronously.  All attributes
    are safe to read immediately after construction.

    Attributes:
        nodes:         All intersection nodes keyed by their string ID.
        roads:         All directed road segments keyed by their string ID.
        intersections: Centre coordinates of every intersection, in grid order
                       (gx-major, gz-minor).
        bounds:        World-space AABB of the drivable area.
    """

    nodes: Dict[str, MapNode]
    roads: Dict[str, RoadSegment]
    intersections: List[Vector2D]
    bounds: dict

    def __init__(self) -> None:
        """Build the 5 × 5 city grid from scratch."""
        self.nodes = {}
        self.roads = {}
        self.intersections = []
        self._build_grid()
        self._compute_bounds()

    # ------------------------------------------------------------------
    # Private build helpers
    # ------------------------------------------------------------------

    def _build_grid(self) -> None:
        """
        Create all MapNode objects and bidirectional RoadSegment pairs for
        the regular 5 × 5 lattice.

        Node creation pass
        ~~~~~~~~~~~~~~~~~~
        Nodes are created in (gx, gz) order — gx is the column (X axis) and
        gz is the row (Z axis).  Each node gets a staggered traffic-light
        timer so that not all 25 intersections transition simultaneously::

            timer = ((gx * GRID_SIZE + gz) * _TIMER_STAGGER) % 52.0

        The initial signal phase mirrors the TypeScript logic: nodes whose
        ``(gx + gz)`` is even start on *North-South Green*; odd nodes start
        on *East-West Green*.

        Edge creation pass
        ~~~~~~~~~~~~~~~~~~
        After all nodes exist, each adjacent pair ``(n_gx_gz, n_{gx+1}_gz)``
        and ``(n_gx_gz, n_gx_{gz+1})`` receives two directed RoadSegments.
        The road length is the Euclidean distance between the two node
        centres (exactly ``SPACING`` for grid-adjacent nodes, i.e. 75 m).
        """
        # ---- 1. Create nodes -----------------------------------------------
        for gx in range(GRID_SIZE):
            for gz in range(GRID_SIZE):
                node_id = f"n_{gx}_{gz}"
                x = (gx - (GRID_SIZE - 1) / 2.0) * SPACING
                z = (gz - (GRID_SIZE - 1) / 2.0) * SPACING

                # Stagger timer so not all lights are in the same phase
                timer = ((gx * GRID_SIZE + gz) * _TIMER_STAGGER) % 52.0

                # Even-sum nodes → NS green, odd-sum nodes → EW green
                if (gx + gz) % 2 == 0:
                    ns_state = "green"
                    ew_state = "red"
                    phase_index = 1
                    phase_name = "North-South Green"
                else:
                    ns_state = "red"
                    ew_state = "green"
                    phase_index = 4
                    phase_name = "East-West Green"

                traffic_light = IntersectionTrafficLight(
                    ns_state=ns_state,
                    ew_state=ew_state,
                    timer=timer,
                    cycle_duration=52.0,
                    phase_index=phase_index,
                    phase_name=phase_name,
                    phase_time_remaining=20.0,
                    emergency_override_axis=None,
                    emergency_override_timer=0.0,
                )

                node = MapNode(
                    id=node_id,
                    x=x,
                    z=z,
                    node_type="intersection",
                    connected_node_ids=[],
                    traffic_light=traffic_light,
                )
                self.nodes[node_id] = node
                self.intersections.append(Vector2D(x=x, z=z))

        # ---- 2. Create directed road segments ------------------------------
        for gx in range(GRID_SIZE):
            for gz in range(GRID_SIZE):
                from_id = f"n_{gx}_{gz}"
                from_node = self.nodes[from_id]

                # East neighbour: gx → gx+1 (same gz)
                if gx < GRID_SIZE - 1:
                    east_id = f"n_{gx + 1}_{gz}"
                    east_node = self.nodes[east_id]

                    # Register adjacency (bidirectional)
                    if east_id not in from_node.connected_node_ids:
                        from_node.connected_node_ids.append(east_id)
                    if from_id not in east_node.connected_node_ids:
                        east_node.connected_node_ids.append(from_id)

                    seg_len = _node_distance(from_node, east_node)

                    # from → east
                    road_id_fe = f"road_{from_id}_{east_id}"
                    self.roads[road_id_fe] = RoadSegment(
                        id=road_id_fe,
                        from_node_id=from_id,
                        to_node_id=east_id,
                        lanes=_LANES,
                        length=seg_len,
                        speed_limit=_SPEED_LIMIT,
                        capacity=_CAPACITY,
                        current_vehicle_count=0,
                        is_blocked=False,
                        waypoints=[],
                    )

                    # east → from
                    road_id_ef = f"road_{east_id}_{from_id}"
                    self.roads[road_id_ef] = RoadSegment(
                        id=road_id_ef,
                        from_node_id=east_id,
                        to_node_id=from_id,
                        lanes=_LANES,
                        length=seg_len,
                        speed_limit=_SPEED_LIMIT,
                        capacity=_CAPACITY,
                        current_vehicle_count=0,
                        is_blocked=False,
                        waypoints=[],
                    )

                # South neighbour: gz → gz+1 (same gx)
                if gz < GRID_SIZE - 1:
                    south_id = f"n_{gx}_{gz + 1}"
                    south_node = self.nodes[south_id]

                    # Register adjacency (bidirectional)
                    if south_id not in from_node.connected_node_ids:
                        from_node.connected_node_ids.append(south_id)
                    if from_id not in south_node.connected_node_ids:
                        south_node.connected_node_ids.append(from_id)

                    seg_len = _node_distance(from_node, south_node)

                    # from → south
                    road_id_fs = f"road_{from_id}_{south_id}"
                    self.roads[road_id_fs] = RoadSegment(
                        id=road_id_fs,
                        from_node_id=from_id,
                        to_node_id=south_id,
                        lanes=_LANES,
                        length=seg_len,
                        speed_limit=_SPEED_LIMIT,
                        capacity=_CAPACITY,
                        current_vehicle_count=0,
                        is_blocked=False,
                        waypoints=[],
                    )

                    # south → from
                    road_id_sf = f"road_{south_id}_{from_id}"
                    self.roads[road_id_sf] = RoadSegment(
                        id=road_id_sf,
                        from_node_id=south_id,
                        to_node_id=from_id,
                        lanes=_LANES,
                        length=seg_len,
                        speed_limit=_SPEED_LIMIT,
                        capacity=_CAPACITY,
                        current_vehicle_count=0,
                        is_blocked=False,
                        waypoints=[],
                    )

    def _compute_bounds(self) -> None:
        """
        Compute and cache the world-space AABB of the drivable road network.

        The bounds extend one ``SPACING`` unit beyond the outermost
        intersection centres in each direction, matching the TypeScript
        implementation::

            halfExtent = ((GRID_SIZE - 1) * SPACING) / 2
            minX = -halfExtent - SPACING   # −225 for 5×5 grid
            maxX =  halfExtent + SPACING   # +225
            minZ = -halfExtent - SPACING
            maxZ =  halfExtent + SPACING
        """
        half_extent = ((GRID_SIZE - 1) * SPACING) / 2.0
        self.bounds = {
            "min_x": -half_extent - SPACING,
            "max_x":  half_extent + SPACING,
            "min_z": -half_extent - SPACING,
            "max_z":  half_extent + SPACING,
        }

    # ------------------------------------------------------------------
    # Public serialisation
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        """
        Return a fully JSON-serialisable dictionary of the city layout.

        The returned structure is suitable for direct use as a Django REST
        API response body.  It contains:

        * ``nodes``         — mapping of node-id → node dict
        * ``roads``         — mapping of road-id → road dict
        * ``intersections`` — ordered list of ``{x, z}`` dicts
        * ``bounds``        — ``{min_x, max_x, min_z, max_z}`` in metres

        Returns:
            dict: JSON-serialisable representation of the entire city graph.
        """
        return {
            "nodes": {nid: node.to_dict() for nid, node in self.nodes.items()},
            "roads": {rid: road.to_dict() for rid, road in self.roads.items()},
            "intersections": [pt.to_dict() for pt in self.intersections],
            "bounds": dict(self.bounds),
        }


# ---------------------------------------------------------------------------
# Module-level singleton (lazy-init on first import access)
# ---------------------------------------------------------------------------

_city_layout: CityLayout | None = None


def get_city_layout() -> CityLayout:
    """
    Return the module-level singleton :class:`CityLayout`.

    The layout is constructed once on first call and reused thereafter,
    avoiding repeated allocation during API request handling.

    Returns:
        CityLayout: The shared, fully-initialised city road graph.
    """
    global _city_layout
    if _city_layout is None:
        _city_layout = CityLayout()
    return _city_layout


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _node_distance(a: MapNode, b: MapNode) -> float:
    """Euclidean distance between two MapNode world positions."""
    dx = b.x - a.x
    dz = b.z - a.z
    return math.sqrt(dx * dx + dz * dz)
