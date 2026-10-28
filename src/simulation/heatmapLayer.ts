/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CityLayout } from './cityMap';

/**
 * Creates soft radial glow texture for heatmap discs using HTML5 canvas
 */
function createRadialHeatTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.7)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class HeatmapLayer {
  public group: THREE.Group;
  public nodeDensities: Map<string, number> = new Map();
  private discMeshes: Map<string, THREE.Mesh> = new Map();
  private sharedTexture: THREE.CanvasTexture;
  private pulseTimer = 0;

  constructor(city: CityLayout) {
    this.group = new THREE.Group();
    this.group.name = 'V2V_Heatmap_Layer';
    this.sharedTexture = createRadialHeatTexture();

    const discGeo = new THREE.PlaneGeometry(36, 36);

    // Create an interactive heatmap emitter at each intersection node
    city.nodes.forEach((node, nodeId) => {
      this.nodeDensities.set(nodeId, 0);

      const mat = new THREE.MeshBasicMaterial({
        map: this.sharedTexture,
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(discGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(node.x, 0.05, node.z);
      this.group.add(mesh);
      this.discMeshes.set(nodeId, mesh);
    });

    // Default hidden until toggled
    this.group.visible = false;
  }

  /**
   * Registers a V2V packet event near an intersection
   */
  public recordPacket(x: number, z: number, weight = 1.0) {
    let closestNodeId: string | null = null;
    let closestDist = 999.0;

    this.discMeshes.forEach((mesh, nodeId) => {
      const dx = mesh.position.x - x;
      const dz = mesh.position.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < closestDist) {
        closestDist = dist;
        closestNodeId = nodeId;
      }
    });

    if (closestNodeId && closestDist < 50.0) {
      const curr = this.nodeDensities.get(closestNodeId) || 0;
      this.nodeDensities.set(closestNodeId, Math.min(60, curr + weight));
    }
  }

  /**
   * Updates heat disc visual intensities and decays density over time
   */
  public update(dt: number) {
    this.pulseTimer += dt * 3.5;

    this.discMeshes.forEach((mesh, nodeId) => {
      let density = this.nodeDensities.get(nodeId) || 0;

      // Natural density decay
      density = Math.max(0, density - dt * 2.5);
      this.nodeDensities.set(nodeId, density);

      if (!this.group.visible) return;

      const mat = mesh.material as THREE.MeshBasicMaterial;

      if (density < 0.5) {
        // Subtle base presence
        mat.opacity = 0.15;
        mat.color.setHex(0x06b6d4); // Cool cyan
        mesh.scale.set(0.6, 0.6, 1);
      } else if (density < 8) {
        // Moderate communication density
        mat.opacity = 0.45;
        mat.color.setHex(0x38bdf8); // Sky blue
        mesh.scale.set(0.85, 0.85, 1);
      } else if (density < 20) {
        // Elevated communication (Bottleneck warning)
        mat.opacity = 0.7;
        mat.color.setHex(0xf59e0b); // Amber
        mesh.scale.set(1.1, 1.1, 1);
      } else {
        // High density / Gridlock hotspot (Pulsing crimson)
        const pulse = 0.85 + Math.sin(this.pulseTimer) * 0.15;
        mat.opacity = 0.88 * pulse;
        mat.color.setHex(0xef4444); // Crimson
        mesh.scale.set(1.35 * pulse, 1.35 * pulse, 1);
      }
    });
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible;
  }
}
