/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import {
  Wifi,
  Zap,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Radio,
} from 'lucide-react';
import { SimulationEngine } from '../simulation/simulationEngine';
import { V2VPopupMode } from '../types/simulation';

interface OverheadV2VBubblesProps {
  engine: SimulationEngine | null;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  selectedVehicleId?: string | null;
  popupMode?: V2VPopupMode;
}

interface VehicleV2VPopupState {
  vehicleId: string;
  screenX: number;
  screenY: number;
  distanceToCamera: number;
  scale: number;
  title: string;
  detail: string;
  icon: React.ReactNode;
  badgeClass: string;
  pointerClass: string;
  isSelected: boolean;
  isCompact: boolean;
}

export const OverheadV2VBubbles: React.FC<OverheadV2VBubblesProps> = ({
  engine,
  cameraRef,
  selectedVehicleId,
  popupMode = 'selected',
}) => {
  const [popups, setPopups] = useState<VehicleV2VPopupState[]>([]);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    // If popups are completely toggled off, immediately cancel animation loop and clear DOM
    if (popupMode === 'off') {
      setPopups([]);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const updatePopups = () => {
      const camera = cameraRef.current;
      if (!camera || !engine || !engine.vehicles || engine.vehicles.length === 0) {
        setPopups([]);
        animFrameRef.current = requestAnimationFrame(updatePopups);
        return;
      }

      // If in 'selected' mode and no vehicle is selected, skip all heavy 3D projections
      if (popupMode === 'selected' && !selectedVehicleId) {
        setPopups([]);
        animFrameRef.current = requestAnimationFrame(updatePopups);
        return;
      }

      const cameraPos = camera.position;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const tempVec = new THREE.Vector3();

      // Filter vehicles based on mode:
      // 'selected': only selected vehicle + peers communicating with it
      // 'all': all connected vehicles
      let targetVehicles = engine.vehicles;
      if (popupMode === 'selected' && selectedVehicleId) {
        const connectedIds = new Set<string>();
        connectedIds.add(selectedVehicleId);

        // Find direct V2V link partners
        for (const l of engine.v2vLinks) {
          if (l.fromId === selectedVehicleId) connectedIds.add(l.toId);
          if (l.toId === selectedVehicleId) connectedIds.add(l.fromId);
        }

        // Find platoon leader / neighbors
        const selVeh = engine.vehicles.find((v) => v.id === selectedVehicleId);
        if (selVeh) {
          if (selVeh.platoonLeaderId) connectedIds.add(selVeh.platoonLeaderId);
          if (selVeh.v2vNeighbors) selVeh.v2vNeighbors.forEach((id) => connectedIds.add(id));
        }

        // Find platoon followers
        for (const v of engine.vehicles) {
          if (v.platoonLeaderId === selectedVehicleId) connectedIds.add(v.id);
        }

        targetVehicles = engine.vehicles.filter((v) => connectedIds.has(v.id));
      }

      const results: VehicleV2VPopupState[] = [];

      for (let i = 0; i < targetVehicles.length; i++) {
        const v = targetVehicles[i];

        // Find active communication links involving this vehicle
        const activeLinks = engine.v2vLinks.filter(
          (l) => l.fromId === v.id || l.toId === v.id
        );
        const neighborCount = v.v2vNeighbors ? v.v2vNeighbors.length : 0;

        // V2V POPUP EXISTS WHEN VEHICLE IS CONNECTED TO OTHER VEHICLES OR IS SELECTED
        const isConnected =
          v.id === selectedVehicleId ||
          activeLinks.length > 0 ||
          neighborCount > 0 ||
          Boolean(v.isPlatoonFollower) ||
          Boolean(v.isYieldingToEmergency) ||
          Boolean(v.hazardLightsActive) ||
          Boolean(v.approachingNodeId);

        if (!isConnected) continue;

        // 3D position elevated above the vehicle roof (y = 2.8m - 3.2m)
        tempVec.set(v.x, 2.9, v.z);
        const distToCam = tempVec.distanceTo(cameraPos);

        // Project into normalized device coordinates (NDC)
        tempVec.project(camera);

        // Frustum culling: ensure point is in front of camera
        if (tempVec.z >= 1.0 || tempVec.z <= -1.0) continue;

        const screenX = (tempVec.x * 0.5 + 0.5) * w;
        const screenY = (-(tempVec.y * 0.5) + 0.5) * h;

        // Screen boundary culling with margin
        if (screenX < 15 || screenX > w - 15 || screenY < 20 || screenY > h - 20) {
          continue;
        }

        // Adaptive scaling based on camera distance
        const isSelected = v.id === selectedVehicleId;
        const scale = THREE.MathUtils.clamp(1.0 - (distToCam - 25) / 150, 0.70, 1.05);
        const isCompact = distToCam > 85 && !isSelected;

        // Determine dominant V2V message context
        let title = 'V2V MESH';
        let detail = `${neighborCount || activeLinks.length} Peers (${Math.round(v.speed * 3.6)} km/h)`;
        let icon = <Wifi className="w-3 h-3 text-cyan-300 shrink-0" />;
        let badgeClass =
          'bg-slate-900/95 border-cyan-500/80 text-cyan-100 shadow-cyan-950/60 ring-1 ring-cyan-500/30';
        let pointerClass = 'bg-slate-900 border-cyan-500/80';

        const isEmergencyUnit = ['police', 'ambulance', 'fire_engine', 'emergency'].includes(v.type);

        if (
          v.hazardLightsActive ||
          activeLinks.some((l) => l.messageType === 'eebl_emergency_brake')
        ) {
          // 1. Electronic Emergency Brake Light
          title = 'EEBL BRAKE';
          detail = `TTC ${(v.ttc || 1.1).toFixed(1)}s Anti-Collision`;
          icon = <ShieldAlert className="w-3 h-3 text-rose-300 animate-pulse shrink-0" />;
          badgeClass =
            'bg-rose-950/95 border-rose-500/90 text-rose-100 shadow-rose-900/60 ring-1 ring-rose-400/50';
          pointerClass = 'bg-rose-950 border-rose-500/90';
        } else if (
          isEmergencyUnit ||
          v.isYieldingToEmergency ||
          activeLinks.some((l) => l.messageType === 'emergency_clear')
        ) {
          // 2. Emergency Vehicle Alert & Corridor Yielding
          if (isEmergencyUnit) {
            title = 'EVA CORRIDOR';
            detail = 'Preempting | Sirens Active';
            icon = <AlertTriangle className="w-3 h-3 text-red-300 shrink-0" />;
            badgeClass =
              'bg-red-950/95 border-red-500/90 text-red-100 shadow-red-900/60 ring-1 ring-red-400/50';
            pointerClass = 'bg-red-950 border-red-500/90';
          } else {
            title = 'EVA YIELDING';
            detail = 'Corridor Clear to Shoulder';
            icon = <AlertTriangle className="w-3 h-3 text-amber-300 shrink-0" />;
            badgeClass =
              'bg-amber-950/95 border-amber-500/90 text-amber-100 shadow-amber-900/60 ring-1 ring-amber-400/40';
            pointerClass = 'bg-amber-950 border-amber-500/90';
          }
        } else if (
          v.isPlatoonFollower ||
          activeLinks.some((l) => l.messageType === 'cacc_platoon_sync')
        ) {
          // 3. Cooperative Adaptive Cruise Control (Platooning)
          title = 'CACC PLATOON';
          detail = `Linked: ${v.platoonLeaderId || 'Lead'} (0.5s gap)`;
          icon = <Zap className="w-3 h-3 text-emerald-300 shrink-0" />;
          badgeClass =
            'bg-emerald-950/95 border-emerald-500/90 text-emerald-100 shadow-emerald-900/60 ring-1 ring-emerald-400/40';
          pointerClass = 'bg-emerald-950 border-emerald-500/90';
        } else if (
          Boolean(v.approachingNodeId) ||
          activeLinks.some((l) => l.messageType === 'aim_intersection_negotiate')
        ) {
          // 4. Autonomous Intersection Management (AIM)
          title = 'AIM WEAVE';
          detail = `Slot: ${v.approachingNodeId || 'Junction'} (Signal-Free)`;
          icon = <ShieldCheck className="w-3 h-3 text-purple-300 shrink-0" />;
          badgeClass =
            'bg-purple-950/95 border-purple-500/90 text-purple-100 shadow-purple-900/60 ring-1 ring-purple-400/40';
          pointerClass = 'bg-purple-950 border-purple-500/90';
        } else if (
          v.status === 'rerouting' ||
          activeLinks.some((l) => l.messageType === 'dynamic_detour')
        ) {
          // 5. Dynamic In-Route Detour
          title = 'DETOUR SYNC';
          detail = 'A* Congestion Bypass';
          icon = <RefreshCw className="w-3 h-3 text-amber-300 animate-spin shrink-0" />;
          badgeClass =
            'bg-amber-950/95 border-amber-500/90 text-amber-100 shadow-amber-900/60 ring-1 ring-amber-400/40';
          pointerClass = 'bg-amber-950 border-amber-500/90';
        }

        results.push({
          vehicleId: v.id,
          screenX,
          screenY,
          distanceToCamera: distToCam,
          scale,
          title,
          detail,
          icon,
          badgeClass,
          pointerClass,
          isSelected,
          isCompact,
        });
      }

      setPopups(results);
      animFrameRef.current = requestAnimationFrame(updatePopups);
    };

    animFrameRef.current = requestAnimationFrame(updatePopups);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [engine, cameraRef, selectedVehicleId, popupMode]);

  if (popupMode === 'off' || popups.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-30 overflow-hidden">
      {popups.map((p) => (
        <div
          key={p.vehicleId}
          style={{
            left: `${p.screenX}px`,
            top: `${p.screenY}px`,
            transform: `translate(-50%, -100%) scale(${p.scale})`,
            zIndex: p.isSelected ? 50 : 30,
          }}
          className="absolute pointer-events-none flex flex-col items-center transition-transform duration-75 select-none"
        >
          {/* Main Floating Popup Badge */}
          <div
            className={`px-2 py-1 rounded-lg shadow-xl backdrop-blur-md flex flex-col items-start gap-0.5 border ${
              p.badgeClass
            } ${p.isSelected ? 'ring-2 ring-cyan-400 scale-105 shadow-cyan-500/30' : ''}`}
          >
            <div className="flex items-center gap-1.5 w-full">
              {p.icon}
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase whitespace-nowrap">
                {p.title}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1.5 shrink-0" />
            </div>

            {!p.isCompact && (
              <div className="text-[9px] font-mono opacity-85 whitespace-nowrap">
                {p.detail}
              </div>
            )}
          </div>

          {/* Downward Pointer Arrow */}
          <div className={`w-2 h-2 rotate-45 -mt-1 border-r border-b ${p.pointerClass}`} />
        </div>
      ))}
    </div>
  );
};
