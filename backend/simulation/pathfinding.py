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
A* pathfinding implementation for the AMAPP simulation backend.

This module is a direct Python port of ``src/simulation/pathfinding.ts``.
It contains **no Three.js or front-end dependencies** — only pure
computational geometry and graph search.

Overview
--------
* :func:`distance_2d` — Euclidean distance between two :class:`~.types.Vector2D` points.
* :func:`dist_to_segment` — Shortest distance from a point to a line segment.
* :func:`is_road_segment_blocked` — Checks whether any active incident physically
  blocks a directed road segment.
* :func:`find_path` — Full A* search returning ordered waypoints and node-id
  lists, or ``None`` if no path exists.
* :func:`_generate_lane_waypoints` — Converts a list of node IDs into smooth
  right-hand-drive waypoints with a 3.2 m lateral lane offset.

Right-hand drive convention
---------------------------
Waypoints are offset 3.2 m to the right of the road centre-line (when
facing the direction of travel), matching the Three.js vehicle agent
steering logic in the front-end.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, TYPE_CHECKING

from .types import Incident, Vector2D

if TYPE_CHECKING:
    # Avoid circular imports; CityLayout is only referenced in type hints.
    from .city_map import CityLayout

# ---------------------------------------------------------------------------
# Internal A* graph node
# ---------------------------------------------------------------------------

_PROHIBITIVE_PENALTY: float = 10_000.0  # Cost multiplier for blocked segments
_LANE_OFFSET: float = 3.2               # Right-hand lane offset in metres
_APPROACH_PULLBACK: float = 4.0         # Distance to pull back from next node (m)


@dataclass
class AStarNode:
    """
    An entry in the A* open-set, wrapping a map-graph node ID with search
    scores and a back-pointer for path reconstruction.

    Attributes:
        id:      The map node ID this search entry refers to.
        g_score: Actual cost from the start node to this node.
        f_score: Estimated total cost (g + heuristic) through this node.
        parent:  The preceding :class:`AStarNode` in the discovered path, or
                 ``None`` for the start node.
    """

    id: str
    g_score: float = 0.0
    f_score: float = 0.0
    parent: Optional[AStarNode] = field(default=None, repr=False)


# ---------------------------------------------------------------------------
# Public geometry helpers
# ---------------------------------------------------------------------------


def distance_2d(a: Vector2D, b: Vector2D) -> float:
    """
    Calculate the Euclidean distance between two points in the XZ plane.

    Args:
        a: First point.
        b: Second point.

    Returns:
        float: Non-negative Euclidean distance in metres.
    """
    dx = a.x - b.x
    dz = a.z - b.z
    return math.sqrt(dx * dx + dz * dz)


def dist_to_segment(p: Vector2D, a: Vector2D, b: Vector2D) -> float:
    """
    Compute the shortest distance from point *p* to the line segment *AB*.

    If *A* and *B* are the same point the function degenerates to
    :func:`distance_2d(p, a) <distance_2d>`.

    The implementation projects *p* onto the infinite line through *A*→*B*,
    clamps the parameter *t* to ``[0, 1]`` so the projection stays on the
    segment, and returns the distance to that closest point.

    Args:
        p: The query point.
        a: Segment start.
        b: Segment end.

    Returns:
        float: Shortest distance in metres from *p* to segment *AB*.
    """
    l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2
    if l2 == 0.0:
        # Degenerate segment: A == B
        return distance_2d(p, a)

    # Project p onto AB, clamp to [0, 1]
    t = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l2
    t = max(0.0, min(1.0, t))

    closest = Vector2D(
        x=a.x + t * (b.x - a.x),
        z=a.z + t * (b.z - a.z),
    )
    return distance_2d(p, closest)


# ---------------------------------------------------------------------------
# Incident-blockage check
# ---------------------------------------------------------------------------


def is_road_segment_blocked(
    from_id: str,
    to_id: str,
    city: "CityLayout",
    incidents: List[Incident],
) -> bool:
    """
    Determine whether any active incident physically blocks a directed road
    segment.

    Traffic-jam incidents are *not* treated as full blockages — they increase
    congestion weight during A* cost calculation but do not prohibit
    traversal.  All other incident types (**roadblock**, **accident**,
    **construction**, **hazard**) close the segment if their radius plus a
    3-metre safety buffer overlaps the segment geometry.

    Args:
        from_id:   Source node ID of the directed segment to test.
        to_id:     Destination node ID of the directed segment to test.
        city:      The :class:`~.city_map.CityLayout` providing node
                   coordinates.
        incidents: The current list of active :class:`~.types.Incident`
                   objects.

    Returns:
        bool: ``True`` if at least one non-traffic-jam incident blocks this
        segment; ``False`` otherwise (including when either node is missing).
    """
    from_node = city.nodes.get(from_id)
    to_node = city.nodes.get(to_id)
    if from_node is None or to_node is None:
        return False

    from_pt = Vector2D(x=from_node.x, z=from_node.z)
    to_pt = Vector2D(x=to_node.x, z=to_node.z)

    for inc in incidents:
        # Traffic jams slow vehicles down but do not close the road.
        inc_type = getattr(inc, "incident_type", getattr(inc, "type", None))
        if inc_type == "traffic_jam":
            continue

        inc_pt = Vector2D(x=inc.x, z=inc.z)
        d = dist_to_segment(inc_pt, from_pt, to_pt)
        if d < inc.radius + 3.0:
            return True

    return False


# ---------------------------------------------------------------------------
# A* pathfinder
# ---------------------------------------------------------------------------


def find_path(
    start_id: str,
    target_id: str,
    city: "CityLayout",
    incidents: List[Incident],
    avoid_incidents: bool = True,
) -> Optional[dict]:
    """
    Find the lowest-cost path between two intersection nodes using A*.

    Cost model
    ~~~~~~~~~~
    * **Base cost**: Euclidean distance between consecutive nodes (in metres).
    * **Blockage penalty**: Segments blocked by a non-traffic-jam incident
      receive a multiplicative penalty of 10 000, making them practically
      untraversable while preserving graph connectivity (the search never gets
      stuck).
    * **Congestion weight**: ``1 + road.current_vehicle_count × 0.15`` —
      busier roads cost proportionally more, guiding vehicles around saturated
      segments.

    Heuristic
    ~~~~~~~~~
    The admissible heuristic is straight-line Euclidean distance to the
    target node, which never overestimates the true cost and guarantees
    optimal paths.

    Args:
        start_id:        ID of the departure intersection node.
        target_id:       ID of the destination intersection node.
        city:            The :class:`~.city_map.CityLayout` providing the
                         road graph.
        incidents:       Active incidents used to decide blockage and
                         congestion.
        avoid_incidents: When ``False`` the prohibitive penalty is not
                         applied and all segments are treated as open (useful
                         for emergency vehicles that can drive through
                         incidents).

    Returns:
        A dict with two keys on success::

            {
                "path_points":   [{"x": float, "z": float}, ...],
                "path_node_ids": ["n_0_0", "n_1_0", ...],
            }

        Returns ``None`` if *start_id* equals *target_id*, if either node
        does not exist in the graph, or if no path was found.
    """
    if start_id == target_id:
        return None

    start_node = city.nodes.get(start_id)
    target_node = city.nodes.get(target_id)
    if start_node is None or target_node is None:
        return None

    target_pt = Vector2D(x=target_node.x, z=target_node.z)
    start_pt = Vector2D(x=start_node.x, z=start_node.z)

    # Open set: node_id → AStarNode
    open_set: Dict[str, AStarNode] = {}
    closed_set: set[str] = set()

    start_astar = AStarNode(
        id=start_id,
        g_score=0.0,
        f_score=distance_2d(start_pt, target_pt),
    )
    open_set[start_id] = start_astar

    while open_set:
        # Select the open node with the lowest f_score
        current = min(open_set.values(), key=lambda n: n.f_score)

        # Reached the destination — reconstruct and return the path
        if current.id == target_id:
            path_node_ids: List[str] = []
            cursor: Optional[AStarNode] = current
            while cursor is not None:
                path_node_ids.insert(0, cursor.id)
                cursor = cursor.parent

            path_points = _generate_lane_waypoints(path_node_ids, city)
            return {
                "path_points": path_points,
                "path_node_ids": path_node_ids,
            }

        open_set.pop(current.id)
        closed_set.add(current.id)

        current_node = city.nodes.get(current.id)
        if current_node is None:
            continue

        for neighbor_id in current_node.connected_node_ids:
            if neighbor_id in closed_set:
                continue

            neighbor_node = city.nodes.get(neighbor_id)
            if neighbor_node is None:
                continue

            # ------ Cost calculation ----------------------------------------
            # 1. Incident penalty
            penalty = 1.0
            if avoid_incidents and is_road_segment_blocked(
                current.id, neighbor_id, city, incidents
            ):
                penalty = _PROHIBITIVE_PENALTY

            # 2. Congestion weight from road vehicle count
            road_key = f"road_{current.id}_{neighbor_id}"
            road = city.roads.get(road_key)
            congestion_weight = (
                1.0 + road.current_vehicle_count * 0.15 if road is not None else 1.0
            )

            neighbor_pt = Vector2D(x=neighbor_node.x, z=neighbor_node.z)
            current_pt = Vector2D(x=current_node.x, z=current_node.z)

            edge_cost = distance_2d(current_pt, neighbor_pt) * penalty * congestion_weight
            tentative_g = current.g_score + edge_cost

            existing = open_set.get(neighbor_id)
            if existing is None:
                # Discovered a new node
                open_set[neighbor_id] = AStarNode(
                    id=neighbor_id,
                    g_score=tentative_g,
                    f_score=tentative_g + distance_2d(neighbor_pt, target_pt),
                    parent=current,
                )
            elif tentative_g < existing.g_score:
                # Found a cheaper route to an already-known node
                existing.g_score = tentative_g
                existing.f_score = tentative_g + distance_2d(neighbor_pt, target_pt)
                existing.parent = current

    # Exhausted the search without reaching the target
    return None


# ---------------------------------------------------------------------------
# Lane-offset waypoint generator
# ---------------------------------------------------------------------------


def _generate_lane_waypoints(
    node_ids: List[str],
    city: "CityLayout",
) -> List[dict]:
    """
    Convert an ordered list of intersection node IDs into smooth right-hand
    drive waypoints.

    For every consecutive pair of nodes ``(curr, next)`` the function emits
    **three** waypoints, all offset 3.2 m to the right of the road
    centre-line (perpendicular to the direction of travel):

    1. **Segment start** — at the current node centre, right-offset.
    2. **Midpoint** — halfway between the two nodes, right-offset.
    3. **Approach** — 4 m before the next node, right-offset (allows the
       vehicle to decelerate smoothly before the intersection).

    For the **final node** in the path a single waypoint is placed exactly
    at the node centre (no offset), representing the destination.

    The right-hand perpendicular normal for a direction vector ``(dx, dz)``
    is ``(-dz / |d|, dx / |d|)`` — i.e. a 90° clockwise rotation.

    Args:
        node_ids: Ordered list of node IDs forming the path (start → end).
        city:     The :class:`~.city_map.CityLayout` providing node
                  coordinates.

    Returns:
        List of ``{"x": float, "z": float}`` dicts, JSON-serialisable and
        ready for the vehicle steering controller.
    """
    waypoints: List[dict] = []

    for i, node_id in enumerate(node_ids):
        curr_node = city.nodes.get(node_id)
        if curr_node is None:
            continue

        if i < len(node_ids) - 1:
            # ---- Intermediate segment: emit start, mid, and approach points --
            next_node = city.nodes.get(node_ids[i + 1])
            if next_node is None:
                continue

            dx = next_node.x - curr_node.x
            dz = next_node.z - curr_node.z
            length = math.sqrt(dx * dx + dz * dz) or 1.0

            # Right-hand perpendicular unit normal (90° clockwise rotation)
            nx = -dz / length
            nz = dx / length

            # 1. Segment start waypoint
            waypoints.append({
                "x": curr_node.x + nx * _LANE_OFFSET,
                "z": curr_node.z + nz * _LANE_OFFSET,
            })

            # 2. Midpoint waypoint
            mid_x = (curr_node.x + next_node.x) / 2.0
            mid_z = (curr_node.z + next_node.z) / 2.0
            waypoints.append({
                "x": mid_x + nx * _LANE_OFFSET,
                "z": mid_z + nz * _LANE_OFFSET,
            })

            # 3. Approach waypoint (_APPROACH_PULLBACK m before next node)
            dir_x = dx / length
            dir_z = dz / length
            waypoints.append({
                "x": next_node.x - dir_x * _APPROACH_PULLBACK + nx * _LANE_OFFSET,
                "z": next_node.z - dir_z * _APPROACH_PULLBACK + nz * _LANE_OFFSET,
            })

        else:
            # ---- Final destination node: place at node centre ---------------
            waypoints.append({
                "x": curr_node.x,
                "z": curr_node.z,
            })

    return waypoints
