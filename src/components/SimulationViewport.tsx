/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCityLayout } from '../simulation/cityMap';
import { SimulationEngine } from '../simulation/simulationEngine';
import { LuaEngine } from '../simulation/luaEngine';
import { Incident, GraphicsQuality } from '../types/simulation';

export type CameraMode = 'orbit' | 'top_down' | 'chase';
export type IncidentPlaceType = Incident['type'] | null;

interface SimulationViewportProps {
  engineRef: React.MutableRefObject<SimulationEngine | null>;
  luaEngine: LuaEngine;
  cameraMode: CameraMode;
  graphicsQuality?: GraphicsQuality;
  isNightMode: boolean;
  incidentPlaceMode: IncidentPlaceType;
  isCameraFollowing?: boolean;
  externalCameraRef?: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  onIncidentPlaced: () => void;
  onVehicleSelected: (vehicleId: string | null) => void;
  onFpsUpdate: (fps: number) => void;
}

export const SimulationViewport: React.FC<SimulationViewportProps> = ({
  engineRef,
  luaEngine,
  cameraMode,
  graphicsQuality = 'balanced',
  isNightMode,
  incidentPlaceMode,
  isCameraFollowing = true,
  externalCameraRef,
  onIncidentPlaced,
  onVehicleSelected,
  onFpsUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const envTextureRef = useRef<THREE.Texture | null>(null);
  const graphicsQualityRef = useRef(graphicsQuality);
  graphicsQualityRef.current = graphicsQuality;

  // Keep references to dynamic props for interaction
  const incidentPlaceModeRef = useRef(incidentPlaceMode);
  incidentPlaceModeRef.current = incidentPlaceMode;

  const onIncidentPlacedRef = useRef(onIncidentPlaced);
  onIncidentPlacedRef.current = onIncidentPlaced;

  const onVehicleSelectedRef = useRef(onVehicleSelected);
  onVehicleSelectedRef.current = onVehicleSelected;

  const isCameraFollowingRef = useRef(isCameraFollowing);
  isCameraFollowingRef.current = isCameraFollowing;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Detect software WebGL as per Three.js guidelines
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const initialQuality = graphicsQualityRef.current;
    const isPerf = initialQuality === 'performance';
    const isUltra = initialQuality === 'ultra';

    // 2. Initialize WebGLRenderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl && !isPerf,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    const initialPixelRatio = isSoftwareGl || isPerf ? 1 : isUltra ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1.25);
    renderer.setPixelRatio(initialPixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl && !isPerf;
    renderer.shadowMap.type = isUltra ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    rendererRef.current = renderer;

    container.appendChild(renderer.domElement);

    // 3. Scene and Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b101b);
    scene.fog = new THREE.FogExp2(0x0b101b, 0.0028);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.5,
      1200
    );
    camera.position.set(130, 110, 150);
    cameraRef.current = camera;
    if (externalCameraRef) {
      externalCameraRef.current = camera;
    }

    // 4. Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();
    envTextureRef.current = envTexture;
    if (!isPerf) {
      scene.environment = envTexture;
    }

    // 5. Lighting Setup (Warm directional sun + cool hemisphere fill)
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 1.2);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    const dirLight = new THREE.DirectionalLight(0xffedd5, 2.0);
    dirLight.position.set(180, 220, 120);
    dirLight.castShadow = !isSoftwareGl && !isPerf;
    const shadowMapDim = isUltra ? 2048 : 1024;
    dirLight.shadow.mapSize.width = shadowMapDim;
    dirLight.shadow.mapSize.height = shadowMapDim;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 600;
    const shadowD = 220;
    dirLight.shadow.camera.left = -shadowD;
    dirLight.shadow.camera.right = shadowD;
    dirLight.shadow.camera.top = shadowD;
    dirLight.shadow.camera.bottom = -shadowD;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.02;
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    // 6. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera clipping below ground
    controls.minDistance = 15;
    controls.maxDistance = 450;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // 7. Build City and Initialize MAPF Simulation Engine
    const city = buildCityLayout(6, 75, 14);
    scene.add(city.groundMesh);
    scene.add(city.roadMesh);
    scene.add(city.sidewalkMesh);
    scene.add(city.buildingsGroup);
    scene.add(city.propsGroup);

    const simulation = new SimulationEngine(scene, city, luaEngine);
    engineRef.current = simulation;

    // 8. Raycasting for Incident Placement and Vehicle Selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerDown = (event: MouseEvent) => {
      // Only process primary left button click
      if (event.button !== 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // A. Check if Incident Placement Mode is active
      const placeType = incidentPlaceModeRef.current;
      if (placeType) {
        const intersects = raycaster.intersectObject(city.groundMesh);
        if (intersects.length > 0) {
          const pt = intersects[0].point;
          simulation.addIncident(
            placeType,
            pt.x,
            pt.z,
            12.0,
            `${placeType.toUpperCase()} Obstacle`
          );
          onIncidentPlacedRef.current();
        }
        return;
      }

      // B. Vehicle Selection Inspection
      const vehicleMeshes = Array.from(simulation.vehicleMeshes.values());
      const intersects = raycaster.intersectObjects(vehicleMeshes, true);
      if (intersects.length > 0) {
        let obj: THREE.Object3D | null = intersects[0].object;
        while (obj && !obj.userData?.vehicleId && obj.parent) {
          obj = obj.parent;
        }
        if (obj && obj.userData?.vehicleId) {
          const vId = obj.userData.vehicleId;
          simulation.selectedVehicleId = vId;
          onVehicleSelectedRef.current(vId);
          return;
        }
      }

      // Deselect if clicked ground
      simulation.selectedVehicleId = null;
      onVehicleSelectedRef.current(null);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    // 9. Resize Handling
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 10. Animation / Simulation Game Loop
    let animationFrameId = 0;
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          animationFrameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          animationFrameId = window.setTimeout(cb, 60);
        }
      };
      animationFrameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      // FPS tracking
      frameCount++;
      if (now - lastFpsTime >= 1000) {
        onFpsUpdate(Math.round((frameCount * 1000) / (now - lastFpsTime)));
        frameCount = 0;
        lastFpsTime = now;
      }

      // Tick multi-agent simulation physics & pathing
      simulation.tick(delta);

      // Chase cam tracking
      if (simulation.selectedVehicleId && isCameraFollowingRef.current) {
        const targetVeh = simulation.vehicles.find((v) => v.id === simulation.selectedVehicleId);
        if (targetVeh) {
          // Smoothly track vehicle
          const camOffset = new THREE.Vector3(
            -Math.sin(targetVeh.heading) * 22,
            12,
            -Math.cos(targetVeh.heading) * 22
          );
          camera.position.lerp(
            new THREE.Vector3(targetVeh.x + camOffset.x, camOffset.y, targetVeh.z + camOffset.z),
            0.06
          );
          controls.target.lerp(new THREE.Vector3(targetVeh.x, 1.2, targetVeh.z), 0.08);
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        animationFrameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      animationFrameId = requestAnimationFrame(tick);
    }

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      if (isSoftwareGl) {
        clearTimeout(animationFrameId);
      } else {
        cancelAnimationFrame(animationFrameId);
      }
      simulation.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      if (envTextureRef.current) {
        envTextureRef.current.dispose();
        envTextureRef.current = null;
      }
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [luaEngine, onFpsUpdate]);

  // Handle Dynamic Graphics Quality Adjustments for FPS
  useEffect(() => {
    const renderer = rendererRef.current;
    const dir = dirLightRef.current;
    const scene = sceneRef.current;
    if (!renderer || !dir || !scene) return;

    if (graphicsQuality === 'performance') {
      renderer.shadowMap.enabled = false;
      dir.castShadow = false;
      renderer.setPixelRatio(1.0);
      scene.environment = null;
    } else if (graphicsQuality === 'balanced') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.BasicShadowMap;
      dir.castShadow = true;
      if (dir.shadow.map) {
        dir.shadow.map.dispose();
        dir.shadow.map = null;
      }
      dir.shadow.mapSize.set(1024, 1024);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      scene.environment = envTextureRef.current;
    } else if (graphicsQuality === 'ultra') {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      dir.castShadow = true;
      if (dir.shadow.map) {
        dir.shadow.map.dispose();
        dir.shadow.map = null;
      }
      dir.shadow.mapSize.set(2048, 2048);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
      scene.environment = envTextureRef.current;
    }

    renderer.shadowMap.needsUpdate = true;
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => {
            m.needsUpdate = true;
          });
        } else if (mesh.material) {
          mesh.material.needsUpdate = true;
        }
      }
    });
  }, [graphicsQuality]);

  // Handle Camera Mode Changes
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (cameraMode === 'top_down') {
      camera.position.set(0, 240, 0.1);
      controls.target.set(0, 0, 0);
      controls.update();
    } else if (cameraMode === 'orbit') {
      camera.position.set(130, 110, 150);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [cameraMode]);

  // Handle Night / Day Lighting Changes
  useEffect(() => {
    const dir = dirLightRef.current;
    const hemi = hemiLightRef.current;
    if (!dir || !hemi) return;

    if (isNightMode) {
      dir.intensity = 0.4;
      dir.color.setHex(0x38bdf8);
      hemi.intensity = 0.5;
      hemi.color.setHex(0x1e3a8a);
    } else {
      dir.intensity = 2.0;
      dir.color.setHex(0xffedd5);
      hemi.intensity = 1.2;
      hemi.color.setHex(0x93c5fd);
    }
  }, [isNightMode]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative cursor-grab active:cursor-grabbing ${
        incidentPlaceMode ? 'cursor-crosshair active:cursor-crosshair' : ''
      }`}
    />
  );
};
