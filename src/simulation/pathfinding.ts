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
  const cornerRadius = 9.0; // Cornering transition zone distance (m)

  if (nodeIds.length < 2) {
    const node = city.nodes.get(nodeIds[0]);
    return node ? [{ x: node.x, z: node.z }] : [];
  }

  for (let i = 0; i < nodeIds.length - 1; i++) {
    const currNode = city.nodes.get(nodeIds[i])!;
    const nextNode = city.nodes.get(nodeIds[i + 1])!;

    const dx1 = nextNode.x - currNode.x;
    const dz1 = nextNode.z - currNode.z;
    const len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1) || 1;
    const dirX1 = dx1 / len1;
    const dirZ1 = dz1 / len1;
    const nx1 = -dirZ1;
    const nz1 = dirX1;

    // Segment start (offset after previous intersection)
    const startDist = i === 0 ? 0.0 : Math.min(cornerRadius, len1 * 0.3);
    const startX = currNode.x + dirX1 * startDist + nx1 * laneOffset;
    const startZ = currNode.z + dirZ1 * startDist + nz1 * laneOffset;
    waypoints.push({ x: startX, z: startZ });

    // Intermediate points along the straight lane
    const mid1X = currNode.x + dirX1 * (len1 * 0.4) + nx1 * laneOffset;
    const mid1Z = currNode.z + dirZ1 * (len1 * 0.4) + nz1 * laneOffset;
    const mid2X = currNode.x + dirX1 * (len1 * 0.65) + nx1 * laneOffset;
    const mid2Z = currNode.z + dirZ1 * (len1 * 0.65) + nz1 * laneOffset;
    waypoints.push({ x: mid1X, z: mid1Z });
    waypoints.push({ x: mid2X, z: mid2Z });

    // Entry point right before entering the intersection corner
    const entryDist = len1 - cornerRadius;
    const entryX = currNode.x + dirX1 * entryDist + nx1 * laneOffset;
    const entryZ = currNode.z + dirZ1 * entryDist + nz1 * laneOffset;
    waypoints.push({ x: entryX, z: entryZ });

    // Cornering Transition at nextNode
    if (i < nodeIds.length - 2) {
      const futureNode = city.nodes.get(nodeIds[i + 2])!;
      const dx2 = futureNode.x - nextNode.x;
      const dz2 = futureNode.z - nextNode.z;
      const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2) || 1;
      const dirX2 = dx2 / len2;
      const dirZ2 = dz2 / len2;
      const nx2 = -dirZ2;
      const nz2 = dirX2;

      const exitDist = Math.min(cornerRadius, len2 * 0.3);
      const exitX = nextNode.x + dirX2 * exitDist + nx2 * laneOffset;
      const exitZ = nextNode.z + dirZ2 * exitDist + nz2 * laneOffset;

      const dot = dirX1 * dirX2 + dirZ1 * dirZ2;

      if (dot > 0.95) {
        // Straight through intersection
        waypoints.push({
          x: nextNode.x + nx1 * laneOffset,
          z: nextNode.z + nz1 * laneOffset,
        });
      } else {
        // Smooth Cubic Bezier Corner Arc
        const p0 = { x: entryX, z: entryZ };
        const p3 = { x: exitX, z: exitZ };
        const p1 = {
          x: entryX + dirX1 * (cornerRadius * 0.65),
          z: entryZ + dirZ1 * (cornerRadius * 0.65),
        };
        const p2 = {
          x: exitX - dirX2 * (cornerRadius * 0.65),
          z: exitZ - dirZ2 * (cornerRadius * 0.65),
        };

        const curveSteps = 5;
        for (let s = 1; s <= curveSteps; s++) {
          const t = s / (curveSteps + 1);
          const omt = 1 - t;
          const bx =
            omt * omt * omt * p0.x +
            3 * omt * omt * t * p1.x +
            3 * omt * t * t * p2.x +
            t * t * t * p3.x;
          const bz =
            omt * omt * omt * p0.z +
            3 * omt * omt * t * p1.z +
            3 * omt * t * t * p2.z +
            t * t * t * p3.z;
          waypoints.push({ x: bx, z: bz });
        }
      }
    } else {
      waypoints.push({
        x: nextNode.x + nx1 * laneOffset,
        z: nextNode.z + nz1 * laneOffset,
      });
    }
  }

  return waypoints;
}
