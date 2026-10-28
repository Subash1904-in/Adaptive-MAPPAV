/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { SimulationEngine } from '../simulation/simulationEngine';
import { V2VBubble } from '../types/simulation';

interface OverheadV2VBubblesProps {
  engine: SimulationEngine | null;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
}

interface ProjectedBubble extends V2VBubble {
  screenX: number;
  screenY: number;
  visible: boolean;
}

export const OverheadV2VBubbles: React.FC<OverheadV2VBubblesProps> = ({ engine, cameraRef }) => {
  const [projectedBubbles, setProjectedBubbles] = useState<ProjectedBubble[]>([]);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const updatePositions = () => {
      const camera = cameraRef.current;
      if (!camera || !engine) {
        animFrameRef.current = requestAnimationFrame(updatePositions);
        return;
      }

      const active = engine.v2vBubbles;
      if (active.length === 0) {
        setProjectedBubbles([]);
        animFrameRef.current = requestAnimationFrame(updatePositions);
        return;
      }

      const tempVec = new THREE.Vector3();
      const w = window.innerWidth;
      const h = window.innerHeight;

      const results: ProjectedBubble[] = [];

      for (const b of active) {
        // Find current live vehicle position if available
        const veh = engine.vehicles.find((v) => v.id === b.vehicleId);
        const curX = veh ? veh.x : b.x;
        const curZ = veh ? veh.z : b.z;

        tempVec.set(curX, 3.2, curZ);
        tempVec.project(camera);

        // Check if in front of camera frustum
        if (tempVec.z < 1.0 && tempVec.z > -1.0) {
          const screenX = (tempVec.x * 0.5 + 0.5) * w;
          const screenY = (-(tempVec.y * 0.5) + 0.5) * h;

          // Check if inside screen bounds
          if (screenX >= 20 && screenX <= w - 20 && screenY >= 20 && screenY <= h - 20) {
            results.push({
              ...b,
              screenX,
              screenY,
              visible: true,
            });
          }
        }
      }

      setProjectedBubbles(results);
      animFrameRef.current = requestAnimationFrame(updatePositions);
    };

    animFrameRef.current = requestAnimationFrame(updatePositions);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [engine, cameraRef]);

  if (projectedBubbles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-30 overflow-hidden">
      {projectedBubbles.map((b) => {
        const isEmergency = b.type === 'EMERGENCY_CLEAR';
        const isHazard = b.type === 'HAZARD_ALERT';
        const isYield = b.type === 'RIGHT_OF_WAY_YIELD';
        const isRightOfWay = b.type === 'RIGHT_OF_WAY_CLAIM';
        const isJamCascade = b.type === 'TRAFFIC_JAM_CASCADE' || b.type === 'TRAFFIC_JAM_SHOCKWAVE';
        const isBoxClearance = b.type === 'BOX_CLEARANCE_DISPATCH';
        const isGridlockPrevent = b.type === 'GRIDLOCK_PREVENTION';

        return (
          <div
            key={b.id}
            style={{
              left: `${b.screenX}px`,
              top: `${b.screenY}px`,
              transform: 'translate(-50%, -100%)',
            }}
            className="absolute transition-transform duration-75 flex flex-col items-center"
          >
            <div
              className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold tracking-tight shadow-lg border backdrop-blur-md flex items-center gap-1 animate-fadeIn ${
                isEmergency
                  ? 'bg-rose-950/90 border-rose-500/80 text-rose-200 shadow-rose-900/40'
                  : isBoxClearance
                  ? 'bg-emerald-950/95 border-emerald-400 text-emerald-200 shadow-emerald-900/50 ring-1 ring-emerald-400/50'
                  : isGridlockPrevent
                  ? 'bg-purple-950/95 border-purple-400 text-purple-200 shadow-purple-900/50'
                  : isJamCascade
                  ? 'bg-orange-950/95 border-orange-500/90 text-orange-100 shadow-orange-950/60 ring-1 ring-orange-400/40'
                  : isHazard
                  ? 'bg-amber-950/90 border-amber-500/80 text-amber-200 shadow-amber-900/40'
                  : isRightOfWay
                  ? 'bg-cyan-950/90 border-cyan-500/80 text-cyan-200 shadow-cyan-900/40'
                  : isYield
                  ? 'bg-yellow-950/90 border-yellow-500/80 text-yellow-200 shadow-yellow-900/40'
                  : 'bg-indigo-950/90 border-indigo-500/80 text-indigo-200 shadow-indigo-900/40'
              }`}
            >
              <span>{b.text}</span>
            </div>
            {/* Arrow Pointer */}
            <div
              className={`w-1.5 h-1.5 rotate-45 -mt-0.5 border-r border-b ${
                isEmergency
                  ? 'bg-rose-950 border-rose-500'
                  : isBoxClearance
                  ? 'bg-emerald-950 border-emerald-400'
                  : isGridlockPrevent
                  ? 'bg-purple-950 border-purple-400'
                  : isJamCascade
                  ? 'bg-orange-950 border-orange-500'
                  : isHazard
                  ? 'bg-amber-950 border-amber-500'
                  : isRightOfWay
                  ? 'bg-cyan-950 border-cyan-500'
                  : isYield
                  ? 'bg-yellow-950 border-yellow-500'
                  : 'bg-indigo-950 border-indigo-500'
              }`}
            />
          </div>
        );
      })}
    </div>
  );
};
