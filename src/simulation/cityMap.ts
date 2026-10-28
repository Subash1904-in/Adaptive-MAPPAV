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
 * Creates photorealistic 2048x2048 asphalt road texture with micro-aggregate grain,
 * double yellow centerlines, thermoplastic white dashes, oil drip stains, tire skid marks,
 * pedestrian zebra crosswalks, stop bars, and drainage manhole covers.
 */
function createUltraRealisticRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d')!;

  // 1. Base deep asphalt with aggregate noise
  ctx.fillStyle = '#1e242d';
  ctx.fillRect(0, 0, 2048, 2048);

  const imgData = ctx.getImageData(0, 0, 2048, 2048);
  const data = imgData.data;
  // Multi-frequency aggregate stone noise
  for (let i = 0; i < data.length; i += 4) {
    const n1 = (Math.random() - 0.5) * 16;
    const n2 = (Math.random() - 0.5) * 8;
    const speckle = Math.random() < 0.03 ? 24 : 0;
    data[i] = Math.min(255, Math.max(0, data[i] + n1 + n2 + speckle));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n1 + n2 + speckle));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n1 + n2 + speckle + 2));
  }
  ctx.putImageData(imgData, 0, 0);

  // 2. Oil drip stains along traffic centers
  const laneCenters = [256 + 128, 512 + 128, 1024 + 256 + 128, 1536 + 128];
  laneCenters.forEach((cx) => {
    const grad = ctx.createLinearGradient(cx - 60, 0, cx + 60, 0);
    grad.addColorStop(0, 'rgba(15, 18, 24, 0)');
    grad.addColorStop(0.5, 'rgba(12, 14, 18, 0.42)');
    grad.addColorStop(1, 'rgba(15, 18, 24, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 60, 0, 120, 2048);
  });

  // 3. Subtle braking tire skid marks
  ctx.fillStyle = 'rgba(10, 12, 16, 0.35)';
  for (let i = 0; i < 6; i++) {
    const yStart = 300 + i * 280 + Math.random() * 80;
    const h = 120 + Math.random() * 140;
    ctx.fillRect(1024 + 180, yStart, 28, h);
    ctx.fillRect(1024 + 320, yStart, 28, h);
  }

  // 4. Double solid amber center median lines (with slight worn edges)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(1010, 0);
  ctx.lineTo(1010, 2048);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(1038, 0);
  ctx.lineTo(1038, 2048);
  ctx.stroke();

  // Glass bead retroreflective center highlight
  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(1010, 0);
  ctx.lineTo(1010, 2048);
  ctx.moveTo(1038, 0);
  ctx.lineTo(1038, 2048);
  ctx.stroke();

  // 5. Dashed white lane dividers (standard 3m line, 9m gap)
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 8;
  ctx.setLineDash([72, 48]);

  // Left lanes
  ctx.beginPath();
  ctx.moveTo(512, 0);
  ctx.lineTo(512, 2048);
  ctx.stroke();

  // Right lanes
  ctx.beginPath();
  ctx.moveTo(1536, 0);
  ctx.lineTo(1536, 2048);
  ctx.stroke();

  // 6. Solid white shoulder edge lines
  ctx.setLineDash([]);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(48, 0);
  ctx.lineTo(48, 2048);
  ctx.moveTo(2000, 0);
  ctx.lineTo(2000, 2048);
  ctx.stroke();

  // 7. Drainage storm grates along gutters
  ctx.fillStyle = '#334155';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  for (let y = 180; y < 2048; y += 420) {
    // Left curb grate
    ctx.fillRect(52, y, 42, 64);
    for (let bar = y + 8; bar < y + 60; bar += 8) {
      ctx.beginPath();
      ctx.moveTo(56, bar);
      ctx.lineTo(90, bar);
      ctx.stroke();
    }
    // Right curb grate
    ctx.fillRect(1954, y, 42, 64);
    for (let bar = y + 8; bar < y + 60; bar += 8) {
      ctx.beginPath();
      ctx.moveTo(1958, bar);
      ctx.lineTo(1992, bar);
      ctx.stroke();
    }
  }

  // 8. Cast-iron round manhole cover in road center
  ctx.beginPath();
  ctx.arc(880, 1024, 38, 0, Math.PI * 2);
  ctx.fillStyle = '#262e38';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1a1f26';
  ctx.stroke();
  for (let r = 0; r < 8; r++) {
    const ang = (r * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(880, 1024);
    ctx.lineTo(880 + Math.cos(ang) * 32, 1024 + Math.sin(ang) * 32);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

/**
 * Creates 1024x1024 sidewalk paving texture with concrete slab blocks,
 * bevels, expansion joints, and tactile warning curb bumps.
 */
function createUltraRealisticSidewalkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle concrete grain
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    data[i] = Math.min(255, Math.max(0, data[i] + n));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
  }
  ctx.putImageData(imgData, 0, 0);

  // Concrete paver slab tiles (128x128 tiles)
  const tileSize = 128;
  for (let x = 0; x < 1024; x += tileSize) {
    for (let y = 0; y < 1024; y += tileSize) {
      // Dark expansion joint groove
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, tileSize, tileSize);

      // Light bevel highlight on top/left edges
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + tileSize - 2);
      ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x + tileSize - 2, y + 2);
      ctx.stroke();
    }
  }

  // Yellow tactile blister warning paving on outer edge strip
  ctx.fillStyle = '#eab308';
  ctx.fillRect(0, 960, 1024, 64);
  ctx.fillStyle = '#ca8a04';
  for (let x = 12; x < 1024; x += 24) {
    for (let y = 972; y < 1024; y += 24) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Creates modern glass curtain-wall architectural facade textures with
 * aluminum mullions, floor spandrel panels, and illuminated interior office windows.
 */
function createModernFacadeTexture(seed: number, styleIndex: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const styles = [
    { base: '#0f172a', mullion: '#334155', glassDay: '#1e293b', glassWarm: '#fef08a', glassCyan: '#38bdf8' },
    { base: '#1c1917', mullion: '#44403c', glassDay: '#292524', glassWarm: '#fed7aa', glassCyan: '#67e8f9' },
    { base: '#0b132b', mullion: '#1c2541', glassDay: '#1e293b', glassWarm: '#fef08a', glassCyan: '#7dd3fc' },
    { base: '#18181b', mullion: '#27272a', glassDay: '#27272a', glassWarm: '#fde047', glassCyan: '#93c5fd' },
  ];
  const style = styles[styleIndex % styles.length];

  // Base building frame
  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, 1024, 1024);

  const cols = 12;
  const rows = 16;
  const winW = 62;
  const winH = 46;
  const padX = (1024 - cols * winW) / (cols + 1);
  const padY = (1024 - rows * winH) / (rows + 1);

  for (let r = 0; r < rows; r++) {
    // Floor horizontal spandrel slab
    ctx.fillStyle = style.mullion;
    ctx.fillRect(0, r * (winH + padY), 1024, padY);

    for (let c = 0; c < cols; c++) {
      const x = padX + c * (winW + padX);
      const y = padY + r * (winH + padY);

      // Vertical mullion frame
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x - 3, y - 3, winW + 6, winH + 6);

      // Window illumination logic
      const rand = Math.sin(seed * 73 + r * 19 + c * 37);
      if (rand > 0.18) {
        // Office illuminated with warm tint or cool tech tint
        const isWarm = (r + c + seed) % 3 === 0;
        ctx.fillStyle = isWarm ? style.glassWarm : style.glassCyan;
        ctx.fillRect(x, y, winW, winH);

        // Architectural horizontal blinds / shades
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect(x, y + winH * 0.35, winW, 4);
      } else {
        // Tinted reflective glass
        ctx.fillStyle = style.glassDay;
        ctx.fillRect(x, y, winW, winH);
      }
    }
  }

  // Ground-floor entrance retail lobby with floor-to-ceiling glass
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 1024 - 110, 1024, 110);
  ctx.fillStyle = 'rgba(254, 240, 138, 0.65)';
  for (let door = 60; door < 1024; door += 180) {
    ctx.fillRect(door, 1024 - 95, 120, 80);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    ctx.strokeRect(door, 1024 - 95, 120, 80);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Creates high-detail procedural street tree with wooden trunk and multi-cluster foliage canopy.
 */
function createDetailedStreetTree(scale = 1.0): THREE.Group {
  const tree = new THREE.Group();

  // Bark trunk
  const trunkGeo = new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, 3.8 * scale, 8);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x3e2723,
    roughness: 0.9,
    metalness: 0.1,
  });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.9 * scale;
  trunk.castShadow = true;
  tree.add(trunk);

  // Multi-cluster lush canopy
  const foliageMat1 = new THREE.MeshStandardMaterial({
    color: 0x1b5e20, // Forest emerald
    roughness: 0.85,
    metalness: 0.05,
  });
  const foliageMat2 = new THREE.MeshStandardMaterial({
    color: 0x2e7d32, // Leaf green
    roughness: 0.8,
  });

  const clusters = [
    { x: 0, y: 4.2 * scale, z: 0, r: 1.8 * scale, mat: foliageMat1 },
    { x: 0.7 * scale, y: 3.8 * scale, z: 0.4 * scale, r: 1.4 * scale, mat: foliageMat2 },
    { x: -0.6 * scale, y: 3.9 * scale, z: -0.5 * scale, r: 1.5 * scale, mat: foliageMat1 },
    { x: 0.3 * scale, y: 5.1 * scale, z: -0.2 * scale, r: 1.2 * scale, mat: foliageMat2 },
  ];

  clusters.forEach((c) => {
    const geo = new THREE.DodecahedronGeometry(c.r, 1);
    const m = new THREE.Mesh(geo, c.mat);
    m.position.set(c.x, c.y, c.z);
    m.castShadow = true;
    m.receiveShadow = true;
    tree.add(m);
  });

  return tree;
}

/**
 * Builds the complete high-fidelity 6x6 urban city layout with realistic asphalt roads,
 * zebra crosswalks, sidewalk pavers, modern architectural office towers, rooftop helipads,
 * street trees, streetlamps, and traffic signals.
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

  // 2. Connect Grid Nodes with directional Road Segments
  for (let gx = 0; gx < gridSize; gx++) {
    for (let gz = 0; gz < gridSize; gz++) {
      const fromId = `node_${gx}_${gz}`;
      const fromNode = nodes.get(fromId)!;

      // East-West connections
      if (gx < gridSize - 1) {
        const eastId = `node_${gx + 1}_${gz}`;
        const eastNode = nodes.get(eastId)!;
        fromNode.connectedNodeIds.push(eastId);
        eastNode.connectedNodeIds.push(fromId);

        const roadId1 = `road_${fromId}_${eastId}`;
        roads.set(roadId1, {
          id: roadId1,
          fromNodeId: fromId,
          toNodeId: eastId,
          lanes: 3,
          length: spacing,
          speedLimit: 14.0,
          capacity: 16,
          currentVehicleCount: 0,
          isBlocked: false,
          waypoints: [
            { x: fromNode.x + roadWidth * 0.3, z: fromNode.z },
            { x: eastNode.x - roadWidth * 0.3, z: eastNode.z },
          ],
        });

        const roadId2 = `road_${eastId}_${fromId}`;
        roads.set(roadId2, {
          id: roadId2,
          fromNodeId: eastId,
          toNodeId: fromId,
          lanes: 3,
          length: spacing,
          speedLimit: 14.0,
          capacity: 16,
          currentVehicleCount: 0,
          isBlocked: false,
          waypoints: [
            { x: eastNode.x - roadWidth * 0.3, z: eastNode.z },
            { x: fromNode.x + roadWidth * 0.3, z: fromNode.z },
          ],
        });
      }

      // North-South connections
      if (gz < gridSize - 1) {
        const southId = `node_${gx}_${gz + 1}`;
        const southNode = nodes.get(southId)!;
        fromNode.connectedNodeIds.push(southId);
        southNode.connectedNodeIds.push(fromId);

        const roadId1 = `road_${fromId}_${southId}`;
        roads.set(roadId1, {
          id: roadId1,
          fromNodeId: fromId,
          toNodeId: southId,
          lanes: 3,
          length: spacing,
          speedLimit: 14.0,
          capacity: 16,
          currentVehicleCount: 0,
          isBlocked: false,
          waypoints: [
            { x: fromNode.x, z: fromNode.z + roadWidth * 0.3 },
            { x: southNode.x, z: southNode.z - roadWidth * 0.3 },
          ],
        });

        const roadId2 = `road_${southId}_${fromId}`;
        roads.set(roadId2, {
          id: roadId2,
          fromNodeId: southId,
          toNodeId: fromId,
          lanes: 3,
          length: spacing,
          speedLimit: 14.0,
          capacity: 16,
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

  // 3. Ground Terrain with Landscape Grass/Park base
  const totalGroundSize = (gridSize + 2) * spacing;
  const groundGeo = new THREE.PlaneGeometry(totalGroundSize, totalGroundSize);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    roughness: 0.98,
    metalness: 0.05,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.05;
  groundMesh.receiveShadow = true;

  // 4. Photorealistic Asphalt Road Strips & Crosswalks
  const roadTex = createUltraRealisticRoadTexture();
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.78,
    metalness: 0.22,
  });
  roadMat.polygonOffset = true;
  roadMat.polygonOffsetFactor = -1;
  roadMat.polygonOffsetUnits = -1;

  const roadGroup = new THREE.Group();
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
    rMesh.rotation.z = Math.PI / 2;
    rMesh.position.set(x, 0.012, 0);
    rMesh.receiveShadow = true;
    roadGroup.add(rMesh);
  }

  // Pedestrian Zebra Crosswalk Markings at Intersections
  const zebraWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.5,
    metalness: 0.1,
  });

  intersections.forEach((pt) => {
    // 4 crosswalk strips at each intersection (North, South, East, West approaches)
    const offsets = [
      { x: 0, z: -roadWidth * 0.75, rot: 0 },
      { x: 0, z: roadWidth * 0.75, rot: 0 },
      { x: -roadWidth * 0.75, z: 0, rot: Math.PI / 2 },
      { x: roadWidth * 0.75, z: 0, rot: Math.PI / 2 },
    ];

    offsets.forEach((off) => {
      // 8 zebra stripes per crosswalk
      for (let s = -5; s <= 5; s += 1.4) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 3.2), zebraWhiteMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.rotation.z = off.rot;
        if (off.rot === 0) {
          stripe.position.set(pt.x + s, 0.02, pt.z + off.z);
        } else {
          stripe.position.set(pt.x + off.x, 0.02, pt.z + s);
        }
        roadGroup.add(stripe);
      }

      // Stop Bar line in front of crosswalk
      const stopBar = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth * 0.85, 0.55), zebraWhiteMat);
      stopBar.rotation.x = -Math.PI / 2;
      stopBar.rotation.z = off.rot;
      const barDist = roadWidth * 1.05;
      if (off.rot === 0) {
        stopBar.position.set(pt.x, 0.021, pt.z + (off.z > 0 ? barDist : -barDist));
      } else {
        stopBar.position.set(pt.x + (off.x > 0 ? barDist : -barDist), 0.021, pt.z);
      }
      roadGroup.add(stopBar);
    });
  });

  const roadContainer = new THREE.Mesh();
  roadContainer.add(roadGroup);

  // 5. Sidewalk Paver Meshes with Raised Granular Curbs
  const sidewalkTex = createUltraRealisticSidewalkTexture();
  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: sidewalkTex,
    roughness: 0.88,
    metalness: 0.12,
  });

  const sidewalkGroup = new THREE.Group();
  const blockSize = spacing - roadWidth;
  const blockGeo = new THREE.BoxGeometry(blockSize, 0.28, blockSize);

  for (let gx = 0; gx < gridSize - 1; gx++) {
    for (let gz = 0; gz < gridSize - 1; gz++) {
      const cx = (gx - (gridSize - 1) / 2 + 0.5) * spacing;
      const cz = (gz - (gridSize - 1) / 2 + 0.5) * spacing;

      const blockMesh = new THREE.Mesh(blockGeo, sidewalkMat);
      blockMesh.position.set(cx, 0.14, cz);
      blockMesh.receiveShadow = true;
      sidewalkGroup.add(blockMesh);
    }
  }

  const sidewalkContainer = new THREE.Mesh();
  sidewalkContainer.add(sidewalkGroup);

  // 6. Modern Architectural Glass Towers with Rooftop Details
  const buildingsGroup = new THREE.Group();
  const buildingMats = [
    new THREE.MeshStandardMaterial({ map: createModernFacadeTexture(1, 0), roughness: 0.35, metalness: 0.65 }),
    new THREE.MeshStandardMaterial({ map: createModernFacadeTexture(2, 1), roughness: 0.4, metalness: 0.6 }),
    new THREE.MeshStandardMaterial({ map: createModernFacadeTexture(3, 2), roughness: 0.3, metalness: 0.75 }),
    new THREE.MeshStandardMaterial({ map: createModernFacadeTexture(4, 3), roughness: 0.45, metalness: 0.55 }),
  ];

  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.9,
    metalness: 0.15,
  });

  const propsGroup = new THREE.Group();

  for (let gx = 0; gx < gridSize - 1; gx++) {
    for (let gz = 0; gz < gridSize - 1; gz++) {
      const blockCenterX = (gx - (gridSize - 1) / 2 + 0.5) * spacing;
      const blockCenterZ = (gz - (gridSize - 1) / 2 + 0.5) * spacing;

      const subOffsets = [
        { dx: -blockSize * 0.25, dz: -blockSize * 0.25 },
        { dx: blockSize * 0.25, dz: -blockSize * 0.25 },
        { dx: -blockSize * 0.25, dz: blockSize * 0.25 },
        { dx: blockSize * 0.25, dz: blockSize * 0.25 },
      ];

      subOffsets.forEach((off, idx) => {
        const seed = (gx * 19 + gz * 37 + idx * 11) % 100;
        const height = 22 + (seed % 56);
        const width = blockSize * 0.42;
        const depth = blockSize * 0.42;

        const bGroup = new THREE.Group();

        // Main glass tower body
        const mat = buildingMats[(gx + gz + idx) % buildingMats.length];
        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const bodyMesh = new THREE.Mesh(bodyGeo, mat);
        bodyMesh.position.y = height / 2 + 0.28;
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        bGroup.add(bodyMesh);

        // Rooftop HVAC chiller unit
        const hvacGeo = new THREE.BoxGeometry(width * 0.48, 2.6, depth * 0.48);
        const hvacMesh = new THREE.Mesh(hvacGeo, roofMat);
        hvacMesh.position.y = height + 1.3 + 0.28;
        hvacMesh.castShadow = true;
        bGroup.add(hvacMesh);

        // Tall towers get helipad or telecommunication mast
        if (height > 48) {
          // Antenna mast
          const antenna = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.25, 9.5, 8),
            new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 })
          );
          antenna.position.y = height + 7.5;
          antenna.castShadow = true;
          bGroup.add(antenna);

          // Red pulsing obstruction beacon at tip
          const beacon = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xef4444 })
          );
          beacon.position.y = height + 12.3;
          bGroup.add(beacon);

          // Helipad circle on roof
          const pad = new THREE.Mesh(
            new THREE.CircleGeometry(width * 0.35, 16),
            new THREE.MeshBasicMaterial({ color: 0xf59e0b })
          );
          pad.rotation.x = -Math.PI / 2;
          pad.position.y = height + 0.29;
          bGroup.add(pad);
        }

        bGroup.position.set(blockCenterX + off.dx, 0, blockCenterZ + off.dz);
        buildingsGroup.add(bGroup);
      });

      // 4 Lush Street Trees along the sidewalk per block
      const treeOffsets = [
        { x: blockCenterX - blockSize * 0.45, z: blockCenterZ },
        { x: blockCenterX + blockSize * 0.45, z: blockCenterZ },
        { x: blockCenterX, z: blockCenterZ - blockSize * 0.45 },
        { x: blockCenterX, z: blockCenterZ + blockSize * 0.45 },
      ];
      treeOffsets.forEach((tPos) => {
        const tree = createDetailedStreetTree(0.9 + (gx * 7 + gz * 13) % 4 * 0.1);
        tree.position.set(tPos.x, 0.28, tPos.z);
        propsGroup.add(tree);
      });
    }
  }

  // 7. Add Street Props: Modern Curved Streetlamps & Traffic Signal Gantries
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

  intersections.forEach((pt) => {
    const offsets = [
      { x: pt.x - roadWidth * 0.65, z: pt.z - roadWidth * 0.65 },
      { x: pt.x + roadWidth * 0.65, z: pt.z - roadWidth * 0.65 },
      { x: pt.x - roadWidth * 0.65, z: pt.z + roadWidth * 0.65 },
      { x: pt.x + roadWidth * 0.65, z: pt.z + roadWidth * 0.65 },
    ];

    offsets.forEach((corner, idx) => {
      // Modern Curved Streetlamp
      if (idx === 0 || idx === 3) {
        const lampGroup = new THREE.Group();
        lampGroup.position.set(corner.x, 0.28, corner.z);

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.8, 8), lampPoleMat);
        pole.position.y = 3.9;
        pole.castShadow = true;
        lampGroup.add(pole);

        // Curved arm extending towards the street
        const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), lampPoleMat);
        arm.position.set(idx === 0 ? 0.9 : -0.9, 7.7, 0);
        lampGroup.add(arm);

        // Downward glowing light head
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.15, 8), lampHeadMat);
        head.position.set(idx === 0 ? 1.8 : -1.8, 7.6, 0);
        lampGroup.add(head);

        propsGroup.add(lampGroup);
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
