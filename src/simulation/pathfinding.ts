/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CityLayout } from './cityMap';
import { Incident, Vector2D } from '../types/simulation';

interface AStarNode {
  id: string;
  gScore: number;
  fScore: number;
  parent?: AStarNode;
}

/**
 * Calculates Euclidean distance between two 2D points.
 */
export function distance2D(a: Vector2D, b: Vector2D): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Checks if a road segment is blocked by any active incident.
 */
export function isRoadSegmentBlocked(
  fromNodeId: string,
  toNodeId: string,
  city: CityLayout,
  incidents: Incident[]
): boolean {
  const from = city.nodes.get(fromNodeId);
  const to = city.nodes.get(toNodeId);
  if (!from || !to) return false;

  for (const inc of incidents) {
    // Traffic jams do not close the road completely (cars queue and crawl through)
    if (inc.type === 'traffic_jam') continue;

    // Check distance from incident center to line segment (from -> to)
    const d = distToSegment({ x: inc.x, z: inc.z }, { x: from.x, z: from.z }, { x: to.x, z: to.z });
    if (d < inc.radius + 3.0) {
      return true;
    }
  }
  return false;
}

/**
 * Shortest distance from point P to line segment AB.
 */
function distToSegment(p: Vector2D, a: Vector2D, b: Vector2D): number {
  const l2 = (b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z);
  if (l2 === 0) return distance2D(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l2;
  t = Math.max(0, Math.min(1, t));
  return distance2D(p, {
    x: a.x + t * (b.x - a.x),
    z: a.z + t * (b.z - a.z),
  });
}

/**
 * A* Pathfinding implementation with dynamic incident penalty and congestion weights.
 */
export function findPath(
  startNodeId: string,
  targetNodeId: string,
  city: CityLayout,
  incidents: Incident[],
  avoidIncidents = true
): { pathPoints: Vector2D[]; pathNodeIds: string[] } | null {
  if (startNodeId === targetNodeId) return null;

  const startNode = city.nodes.get(startNodeId);
  const targetNode = city.nodes.get(targetNodeId);
  if (!startNode || !targetNode) return null;

  const openSet = new Map<string, AStarNode>();
  const closedSet = new Set<string>();

  const startAStar: AStarNode = {
    id: startNodeId,
    gScore: 0,
    fScore: distance2D(startNode, targetNode),
  };
  openSet.set(startNodeId, startAStar);

  while (openSet.size > 0) {
    // Find node with lowest fScore
    let current: AStarNode | null = null;
    for (const node of openSet.values()) {
      if (!current || node.fScore < current.fScore) {
        current = node;
      }
    }

    if (!current) break;

    // Reached destination
    if (current.id === targetNodeId) {
      const pathNodeIds: string[] = [];
      let curr: AStarNode | undefined = current;
      while (curr) {
        pathNodeIds.unshift(curr.id);
        curr = curr.parent;
      }

      // Generate detailed driving waypoints with right-hand lane offset
      const pathPoints = generateSmoothLaneWaypoints(pathNodeIds, city);
      return { pathPoints, pathNodeIds };
    }

    openSet.delete(current.id);
    closedSet.add(current.id);

    const currentNode = city.nodes.get(current.id);
    if (!currentNode) continue;

    for (const neighborId of currentNode.connectedNodeIds) {
      if (closedSet.has(neighborId)) continue;

      const neighborNode = city.nodes.get(neighborId);
      if (!neighborNode) continue;

      // Check incident blockage
      let penalty = 1.0;
      if (avoidIncidents && isRoadSegmentBlocked(current.id, neighborId, city, incidents)) {
        penalty = 10000.0; // Prohibitive cost for blocked segment
      }

      const roadKey = `road_${current.id}_${neighborId}`;
      const road = city.roads.get(roadKey);
      const congestionWeight = road ? 1 + road.currentVehicleCount * 0.15 : 1.0;

      const edgeCost = distance2D(currentNode, neighborNode) * penalty * congestionWeight;
      const tentativeGScore = current.gScore + edgeCost;

      const neighborAStar = openSet.get(neighborId);
      if (!neighborAStar) {
        openSet.set(neighborId, {
          id: neighborId,
          gScore: tentativeGScore,
          fScore: tentativeGScore + distance2D(neighborNode, targetNode),
          parent: current,
        });
      } else if (tentativeGScore < neighborAStar.gScore) {
        neighborAStar.gScore = tentativeGScore;
        neighborAStar.fScore = tentativeGScore + distance2D(neighborNode, targetNode);
        neighborAStar.parent = current;
      }
    }
  }

  return null;
}

/**
 * Generates smooth multi-lane waypoints with right-hand drive offset
 * and corner bevels for realistic vehicular cornering.
 */
function generateSmoothLaneWaypoints(nodeIds: string[], city: CityLayout): Vector2D[] {
  const waypoints: Vector2D[] = [];
  const laneOffset = 3.2; // Right-hand traffic offset in meters

  for (let i = 0; i < nodeIds.length; i++) {
    const currNode = city.nodes.get(nodeIds[i])!;

    if (i < nodeIds.length - 1) {
      const nextNode = city.nodes.get(nodeIds[i + 1])!;
      const dx = nextNode.x - currNode.x;
      const dz = nextNode.z - currNode.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;

      // Normal perpendicular vector pointing right
      const nx = -dz / len;
      const nz = dx / len;

      // Segment start waypoint
      waypoints.push({
        x: currNode.x + nx * laneOffset,
        z: currNode.z + nz * laneOffset,
      });

      // Midpoint waypoint
      waypoints.push({
        x: (currNode.x + nextNode.x) / 2 + nx * laneOffset,
        z: (currNode.z + nextNode.z) / 2 + nz * laneOffset,
      });

      // Segment approach waypoint
      waypoints.push({
        x: nextNode.x - (dx / len) * 4.0 + nx * laneOffset,
        z: nextNode.z - (dz / len) * 4.0 + nz * laneOffset,
      });
    } else {
      // Final destination node
      waypoints.push({
        x: currNode.x,
        z: currNode.z,
      });
    }
  }

  return waypoints;
}
