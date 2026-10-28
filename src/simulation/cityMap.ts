/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { MapNode, RoadSegment, Vector2D } from '../types/simulation';

export interface CityLayout {
  nodes: Map<string, MapNode>;
  roads: Map<string, RoadSegment>;
  intersections: Vector2D[];
  groundMesh: THREE.Mesh;
  roadMesh: THREE.Mesh;
  sidewalkMesh: THREE.Mesh;
  buildingsGroup: THREE.Group;
  propsGroup: THREE.Group;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * Creates high-fidelity procedural road textures using HTML5 Canvas.
 */
function createRoadCanvasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Base asphalt with subtle noise
  ctx.fillStyle = '#1c2128';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle asphalt grain
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 12;
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  }
  ctx.putImageData(imgData, 0, 0);

  // Double yellow center line
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(506, 0);
  ctx.lineTo(506, 1024);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(518, 0);
  ctx.lineTo(518, 1024);
  ctx.stroke();

  // Dashed white lane dividers
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 6;
  ctx.setLineDash([48, 32]);

  // Left side lane divider
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 1024);
  ctx.stroke();

  // Right side lane divider
  ctx.beginPath();
  ctx.moveTo(768, 0);
  ctx.lineTo(768, 1024);
  ctx.stroke();

  // Solid white shoulder edge lines
  ctx.setLineDash([]);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(32, 1024);
  ctx.moveTo(992, 0);
  ctx.lineTo(992, 1024);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Creates sidewalk paving texture
 */
function createSidewalkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 512, 512);

  // Paver tile grid
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 3;
  const tileSize = 64;
  for (let x = 0; x < 512; x += tileSize) {
    for (let y = 0; y < 512; y += tileSize) {
      ctx.strokeRect(x, y, tileSize, tileSize);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Creates realistic building facade texture with illuminated windows
 */
function createBuildingTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base building wall tone (dark modern corporate or brick)
  const isDarkModern = seed % 2 === 0;
  ctx.fillStyle = isDarkModern ? '#1e2638' : '#2b2320';
  ctx.fillRect(0, 0, 512, 512);

  // Window grid
  const cols = 8;
  const rows = 12;
  const winW = 36;
  const winH = 26;
  const padX = (512 - cols * winW) / (cols + 1);
  const padY = (512 - rows * winH) / (rows + 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * (winW + padX);
      const y = padY + r * (winH + padY);

      // Window frame
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x - 2, y - 2, winW + 4, winH + 4);

      // Glass lighting
      const rand = Math.sin(seed * 99 + r * 13 + c * 31);
      if (rand > 0.25) {
        // Warm office illumination
        const warmTint = rand > 0.6 ? '#fef08a' : '#fed7aa';
        ctx.fillStyle = warmTint;
        ctx.fillRect(x, y, winW, winH);

        // Blinds / interior divider
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(x, y + winH * 0.4, winW, 3);
      } else {
        // Dark reflective glass
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, y, winW, winH);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Builds the GTA-style urban city layout with interconnected intersections,
 * multi-lane roads, buildings, trees, and street props.
 */
export function buildCityLayout(gridSize = 6, spacing = 75, roadWidth = 14): CityLayout {
  const nodes = new Map<string, MapNode>();
  const roads = new Map<string, RoadSegment>();
  const intersections: Vector2D[] = [];

  const halfExtent = ((gridSize - 1) * spacing) / 2;
  const bounds = {
    minX: -halfExtent - spacing,
    maxX: halfExtent + spacing,
    minZ: -halfExtent - spacing,
    maxZ: halfExtent + spacing,
  };

  // 1. Create Grid Nodes (Intersections)
  for (let gx = 0; gx < gridSize; gx++) {
    for (let gz = 0; gz < gridSize; gz++) {
      const id = `node_${gx}_${gz}`;
      const x = (gx - (gridSize - 1) / 2) * spacing;
      const z = (gz - (gridSize - 1) / 2) * spacing;

      nodes.set(id, {
        id,
        x,
        z,
        type: 'intersection',
        connectedNodeIds: [],
        trafficLight: {
          nsState: (gx + gz) % 2 === 0 ? 'green' : 'red',
          ewState: (gx + gz) % 2 === 0 ? 'red' : 'green',
          timer: (gx + gz) % 2 === 0 ? 0.0 : 26.0,
          cycleDuration: 52.0,
          phaseIndex: (gx + gz) % 2 === 0 ? 1 : 4,
          phaseName: (gx + gz) % 2 === 0 ? 'North-South Green' : 'East-West Green',
          phaseTimeRemaining: 20.0,
          emergencyOverrideAxis: null,
          emergencyOverrideTimer: 0,
        },
      });

      intersections.push({ x, z });
    }
  }

  // 2. Connect Grid Nodes with directional Road Segments (Bi-directional multi-lane)
  for (let gx = 0; gx < gridSize; gx++) {
    for (let gz = 0; gz < gridSize; gz++) {
      const fromId = `node_${gx}_${gz}`;
      const fromNode = nodes.get(fromId)!;

      // Connect East-West
      if (gx < gridSize - 1) {
        const eastId = `node_${gx + 1}_${gz}`;
        const eastNode = nodes.get(eastId)!;
        fromNode.connectedNodeIds.push(eastId);
        eastNode.connectedNodeIds.push(fromId);

        // Segment A -> B
        const roadId1 = `road_${fromId}_${eastId}`;
        roads.set(roadId1, {
          id: roadId1,
          fromNodeId: fromId,
          toNodeId: eastId,
          lanes: 2,
          length: spacing,
          speedLimit: 14.0, // m/s (~50 km/h)
          capacity: 12,
          currentVehicleCount: 0,
          isBlocked: false,
          waypoints: [
            { x: fromNode.x + roadWidth * 0.3, z: fromNode.z },
            { x: eastNode.x - roadWidth * 0.3, z: eastNode.z },
          ],
        });

        // Segment B -> A
        const roadId2 = `road_${eastId}_${fromId}`;
        roads.set(roadId2, {
          id: roadId2,
          fromNodeId: eastId,
          toNodeId: fromId,
          lanes: 2,
          length: spacing,
          speedLimit: 14.0,
          capacity: 12,
          currentVehicleCount: 0,
          isBlocked: false,
          waypoints: [
            { x: eastNode.x - roadWidth * 0.3, z: eastNode.z },
            { x: fromNode.x + roadWidth * 0.3, z: fromNode.z },
          ],
        });
      }

      // Connect North-South
      if (gz < gridSize - 1) {
        const southId = `node_${gx}_${gz + 1}`;
        const southNode = nodes.get(southId)!;
        fromNode.connectedNodeIds.push(southId);
        southNode.connectedNodeIds.push(fromId);

        // Segment A -> S
        const roadId1 = `road_${fromId}_${southId}`;
        roads.set(roadId1, {
          id: roadId1,
          fromNodeId: fromId,
          toNodeId: southId,
          lanes: 2,
          length: spacing,
          speedLimit: 14.0,
          capacity: 12,
          currentVehicleCount: 0,
          isBlocked: false,
          waypoints: [
            { x: fromNode.x, z: fromNode.z + roadWidth * 0.3 },
            { x: southNode.x, z: southNode.z - roadWidth * 0.3 },
          ],
        });

        // Segment S -> A
        const roadId2 = `road_${southId}_${fromId}`;
        roads.set(roadId2, {
          id: roadId2,
          fromNodeId: southId,
          toNodeId: fromId,
          lanes: 2,
          length: spacing,
          speedLimit: 14.0,
          capacity: 12,
          currentVehicleCount: 0,
          isBlocked: false,
          waypoints: [
            { x: southNode.x, z: southNode.z - roadWidth * 0.3 },
            { x: fromNode.x, z: fromNode.z + roadWidth * 0.3 },
          ],
        });
      }
    }
  }

  // 3. Create Ground Terrain
  const totalGroundSize = (gridSize + 2) * spacing;
  const groundGeo = new THREE.PlaneGeometry(totalGroundSize, totalGroundSize);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.95,
    metalness: 0.1,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.05;
  groundMesh.receiveShadow = true;

  // 4. Create Road Meshes
  const roadTex = createRoadCanvasTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.82,
    metalness: 0.15,
  });
  roadMat.polygonOffset = true;
  roadMat.polygonOffsetFactor = -1;
  roadMat.polygonOffsetUnits = -1;

  const roadGroup = new THREE.Group();

  // Generate horizontal and vertical road strips
  const roadLength = (gridSize - 1) * spacing + roadWidth;

  // Horizontal roads (along X axis)
  for (let gz = 0; gz < gridSize; gz++) {
    const z = (gz - (gridSize - 1) / 2) * spacing;
    const rGeo = new THREE.PlaneGeometry(roadLength, roadWidth);
    const rMesh = new THREE.Mesh(rGeo, roadMat);
    rMesh.rotation.x = -Math.PI / 2;
    rMesh.position.set(0, 0.01, z);
    rMesh.receiveShadow = true;
    roadGroup.add(rMesh);
  }

  // Vertical roads (along Z axis)
  for (let gx = 0; gx < gridSize; gx++) {
    const x = (gx - (gridSize - 1) / 2) * spacing;
    const rGeo = new THREE.PlaneGeometry(roadWidth, roadLength);
    const rMesh = new THREE.Mesh(rGeo, roadMat);
    rMesh.rotation.x = -Math.PI / 2;
    rMesh.position.set(x, 0.01, 0);
    rMesh.receiveShadow = true;
    roadGroup.add(rMesh);
  }

  // Combine road group into single container mesh
  const roadContainer = new THREE.Mesh();
  roadContainer.add(roadGroup);

  // 5. Create Sidewalk Curb Meshes
  const sidewalkTex = createSidewalkTexture();
  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: sidewalkTex,
    roughness: 0.9,
    metalness: 0.05,
  });

  const sidewalkGroup = new THREE.Group();
  const blockSize = spacing - roadWidth;
  const blockGeo = new THREE.BoxGeometry(blockSize, 0.25, blockSize);

  for (let gx = 0; gx < gridSize - 1; gx++) {
    for (let gz = 0; gz < gridSize - 1; gz++) {
      const cx = (gx - (gridSize - 1) / 2 + 0.5) * spacing;
      const cz = (gz - (gridSize - 1) / 2 + 0.5) * spacing;

      const blockMesh = new THREE.Mesh(blockGeo, sidewalkMat);
      blockMesh.position.set(cx, 0.125, cz);
      blockMesh.receiveShadow = true;
      sidewalkGroup.add(blockMesh);
    }
  }

  const sidewalkContainer = new THREE.Mesh();
  sidewalkContainer.add(sidewalkGroup);

  // 6. Create Procedural GTA-style Buildings in city blocks
  const buildingsGroup = new THREE.Group();
  const buildingMats = [
    new THREE.MeshStandardMaterial({ map: createBuildingTexture(1), roughness: 0.6, metalness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: createBuildingTexture(2), roughness: 0.5, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ map: createBuildingTexture(3), roughness: 0.7, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ map: createBuildingTexture(4), roughness: 0.55, metalness: 0.35 }),
  ];

  // Roof material
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    roughness: 0.9,
    metalness: 0.1,
  });

  // Populate city blocks with varying architectural towers
  for (let gx = 0; gx < gridSize - 1; gx++) {
    for (let gz = 0; gz < gridSize - 1; gz++) {
      const blockCenterX = (gx - (gridSize - 1) / 2 + 0.5) * spacing;
      const blockCenterZ = (gz - (gridSize - 1) / 2 + 0.5) * spacing;

      // 4 sub-lots per block
      const subOffsets = [
        { dx: -blockSize * 0.25, dz: -blockSize * 0.25 },
        { dx: blockSize * 0.25, dz: -blockSize * 0.25 },
        { dx: -blockSize * 0.25, dz: blockSize * 0.25 },
        { dx: blockSize * 0.25, dz: blockSize * 0.25 },
      ];

      subOffsets.forEach((off, idx) => {
        const seed = (gx * 17 + gz * 31 + idx * 7) % 100;
        // Vary heights: 18m to 65m
        const height = 18 + (seed % 48);
        const width = blockSize * 0.42;
        const depth = blockSize * 0.42;

        const bGroup = new THREE.Group();

        // Main tower body
        const mat = buildingMats[(gx + gz + idx) % buildingMats.length];
        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const bodyMesh = new THREE.Mesh(bodyGeo, mat);
        bodyMesh.position.y = height / 2 + 0.25;
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        bGroup.add(bodyMesh);

        // Roof penthouse or HVAC unit
        const hvacGeo = new THREE.BoxGeometry(width * 0.45, 2.5, depth * 0.45);
        const hvacMesh = new THREE.Mesh(hvacGeo, roofMat);
        hvacMesh.position.y = height + 1.25 + 0.25;
        hvacMesh.castShadow = true;
        bGroup.add(hvacMesh);

        // Roof helipad or antenna on tallest towers
        if (height > 45) {
          const antennaGeo = new THREE.CylinderGeometry(0.15, 0.25, 8, 8);
          const antennaMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
          const antennaMesh = new THREE.Mesh(antennaGeo, antennaMat);
          antennaMesh.position.y = height + 6.5;
          antennaMesh.castShadow = true;
          bGroup.add(antennaMesh);

          // Red warning beacon at the tip
          const beaconGeo = new THREE.SphereGeometry(0.3, 8, 8);
          const beaconMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
          const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
          beaconMesh.position.y = height + 10.6;
          bGroup.add(beaconMesh);
        }

        bGroup.position.set(blockCenterX + off.dx, 0, blockCenterZ + off.dz);
        buildingsGroup.add(bGroup);
      });
    }
  }

  // 7. Add Street Props (Streetlights, Traffic Lights, Trees)
  const propsGroup = new THREE.Group();

  // Streetlamp geometry
  const lampPoleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8);
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

  // Traffic light box
  const tlBoxGeo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
  const tlBoxMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
  const tlRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const tlGreenMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

  // Place lamps and traffic signals near intersections
  intersections.forEach((pt) => {
    // 4 corners of intersection
    const offsets = [
      { x: pt.x - roadWidth * 0.6, z: pt.z - roadWidth * 0.6 },
      { x: pt.x + roadWidth * 0.6, z: pt.z - roadWidth * 0.6 },
      { x: pt.x - roadWidth * 0.6, z: pt.z + roadWidth * 0.6 },
      { x: pt.x + roadWidth * 0.6, z: pt.z + roadWidth * 0.6 },
    ];

    offsets.forEach((corner, idx) => {
      // Streetlamp
      if (idx === 0 || idx === 3) {
        const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
        pole.position.set(corner.x, 3.75, corner.z);
        pole.castShadow = true;
        propsGroup.add(pole);

        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), lampHeadMat);
        bulb.position.set(corner.x, 7.6, corner.z);
        propsGroup.add(bulb);
      } else {
        // Traffic Signal Post
        const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
        pole.position.set(corner.x, 3.75, corner.z);
        propsGroup.add(pole);

        const tlBox = new THREE.Mesh(tlBoxGeo, tlBoxMat);
        tlBox.position.set(corner.x, 5.5, corner.z);
        propsGroup.add(tlBox);

        const lensR = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), tlRedMat);
        lensR.position.set(corner.x, 6.0, corner.z + 0.32);
        propsGroup.add(lensR);

        const lensG = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), tlGreenMat);
        lensG.position.set(corner.x, 5.0, corner.z + 0.32);
        propsGroup.add(lensG);
      }
    });
  });

  return {
    nodes,
    roads,
    intersections,
    groundMesh,
    roadMesh: roadContainer,
    sidewalkMesh: sidewalkContainer,
    buildingsGroup,
    propsGroup,
    bounds,
  };
}
