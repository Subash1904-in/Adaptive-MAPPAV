/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Car,
  X,
  Gauge,
  Route,
  Code2,
  Radio,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Zap,
  Target,
  Camera,
  Activity,
  AlertTriangle,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { VehicleAgent } from '../types/simulation';

interface VehicleInspectorPopupProps {
  vehicle: VehicleAgent | null;
  onClose: () => void;
  isCameraFollowing: boolean;
  onToggleCameraFollow: () => void;
}

export const VehicleInspectorPopup: React.FC<VehicleInspectorPopupProps> = ({
  vehicle,
  onClose,
  isCameraFollowing,
  onToggleCameraFollow,
}) => {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'v2v' | 'lua'>('telemetry');
  const [isMinimized, setIsMinimized] = useState(false);

  if (!vehicle) return null;

  const speedKmh = Math.round(vehicle.speed * 3.6);
  const targetSpeedKmh = Math.round(vehicle.targetSpeed * 3.6);
  const isEmergency = ['police', 'ambulance', 'fire_engine', 'emergency'].includes(vehicle.type);

  // Minimized Compact Pill Bar (Zero Screen Occlusion During Chase Follow)
  if (isMinimized) {
    return (
      <div className="fixed top-20 right-5 z-40 flex items-center gap-2.5 px-3.5 py-2 bg-slate-900/90 border border-slate-700/80 rounded-2xl shadow-xl backdrop-blur-md animate-fadeIn pointer-events-auto">
        <div
          className="w-3 h-3 rounded-full border border-white/50 shadow-sm shrink-0"
          style={{ backgroundColor: vehicle.color }}
        />
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className="font-bold text-slate-100 uppercase tracking-wider">
            {vehicle.type.replace('_', ' ')}
          </span>
          <span className="text-[10px] text-slate-400">({vehicle.id})</span>
        </div>

        <div className="h-3.5 w-px bg-slate-700 mx-0.5" />

        <div className="text-xs font-mono font-bold text-cyan-400 tabular-nums">
          {speedKmh} <span className="text-[10px] text-slate-400 font-sans font-normal">km/h</span>
        </div>

        <div className="h-3.5 w-px bg-slate-700 mx-0.5" />

        <button
          onClick={onToggleCameraFollow}
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
            isCameraFollowing
              ? 'bg-cyan-500/20 border-cyan-500/70 text-cyan-300'
              : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
          }`}
          title={isCameraFollowing ? 'Camera Follow: Active (Click to unlock)' : 'Enable Chase Camera Follow'}
        >
          <Camera className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setIsMinimized(false)}
          className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer"
          title="Expand Full Vehicle Telemetry & V2V Journal"
        >
          <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
        </button>

        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          title="Deselect Vehicle"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-20 right-5 z-40 w-96 max-h-[85vh] flex flex-col bg-slate-900/95 border border-slate-700/80 rounded-3xl shadow-2xl backdrop-blur-xl overflow-hidden animate-slideLeft pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70">
        <div className="flex items-center gap-2.5">
          <div
            className="w-3.5 h-3.5 rounded-full border border-white/40 shadow-sm"
            style={{ backgroundColor: vehicle.color }}
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                {vehicle.type.replace('_', ' ')}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                {vehicle.id}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              Priority Lvl: <strong className="text-cyan-400">{vehicle.priority}</strong> · Status:{' '}
              <span className="text-emerald-400 capitalize">{vehicle.status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleCameraFollow}
            className={`p-1.5 rounded-xl border transition-colors cursor-pointer ${
              isCameraFollowing
                ? 'bg-cyan-500/20 border-cyan-500/70 text-cyan-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title={isCameraFollowing ? 'Camera Locked: Chase Follow' : 'Lock Camera Follow'}
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            title="Minimize HUD (Prevents screen overlap during camera follow)"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            title="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Segmented Navigation Tabs */}
      <div className="flex items-center p-1.5 mx-3 my-2 bg-slate-950/80 border border-slate-800 rounded-xl">
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === 'telemetry'
              ? 'bg-slate-800 text-cyan-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Gauge className="w-3.5 h-3.5" />
          <span>Telemetry</span>
        </button>

        <button
          onClick={() => setActiveTab('v2v')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === 'v2v'
              ? 'bg-slate-800 text-indigo-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>V2V Feed ({vehicle.v2vJournal?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('lua')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === 'lua'
              ? 'bg-slate-800 text-emerald-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Lua Logic</span>
        </button>
      </div>

      {/* Tab 1: Real-Time Telemetry & Path Efficiency */}
      {activeTab === 'telemetry' && (
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Speedometer & Acceleration Card */}
          <div className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                <span>Kinematic Velocity</span>
              </span>
              <span className="font-mono text-slate-300">Target: {targetSpeedKmh} km/h</span>
            </div>

            <div className="flex items-baseline justify-between">
              <div className="text-3xl font-extrabold font-mono text-white tabular-nums tracking-tight">
                {speedKmh}
                <span className="text-xs text-slate-500 font-sans font-normal ml-1">km/h</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 font-sans block">Instant G-Force:</span>
                <span
                  className={`text-sm font-bold font-mono tabular-nums ${
                    vehicle.accelerationG < -0.2
                      ? 'text-rose-400'
                      : vehicle.accelerationG > 0.2
                      ? 'text-emerald-400'
                      : 'text-slate-300'
                  }`}
                >
                  {vehicle.accelerationG >= 0 ? `+${vehicle.accelerationG}` : vehicle.accelerationG} G
                </span>
              </div>
            </div>

            {/* Velocity Progress Meter */}
            <div className="w-full bg-slate-800 h-2 rounded-full mt-2.5 overflow-hidden">
              <div
                style={{ width: `${Math.min(100, (speedKmh / 75) * 100)}%` }}
                className={`h-full transition-all duration-150 ${
                  isEmergency ? 'bg-rose-500' : 'bg-cyan-500'
                }`}
              />
            </div>
          </div>

          {/* Path Efficiency Card */}
          <div className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Route className="w-3.5 h-3.5 text-emerald-400" />
                <span>Path Efficiency Rating</span>
              </span>
              <span className="font-mono font-bold text-emerald-300">
                {vehicle.pathEfficiency}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300 pt-1">
              <div>
                <span className="text-[10px] text-slate-500 font-sans block">Waypoints Left:</span>
                <span className="font-semibold text-white">
                  {Math.max(0, vehicle.path.length - vehicle.pathIndex)} / {vehicle.path.length}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-sans block">Dynamic Reroutes:</span>
                <span className="font-semibold text-amber-400">{vehicle.rerouteCount}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-sans block">Distance Driven:</span>
                <span className="font-semibold text-white">
                  {Math.round(vehicle.distanceTraveled)}m
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-sans block">Avoidance Buffer:</span>
                <span className="font-semibold text-cyan-400">{vehicle.avoidanceRadius}m</span>
              </div>
            </div>
          </div>

          {/* Lateral Lane Corridor Yield Indicator */}
          {((vehicle.lateralOffset !== undefined && Math.abs(vehicle.lateralOffset) > 0.1) ||
            vehicle.isYieldingToEmergency) && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-2xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                <span className="font-semibold text-amber-300">Corridor Evacuation</span>
              </div>
              <div className="font-mono text-amber-200 text-right">
                <span className="font-bold text-xs">
                  {vehicle.lateralOffset
                    ? vehicle.lateralOffset >= 0
                      ? `+${vehicle.lateralOffset.toFixed(1)}m`
                      : `${vehicle.lateralOffset.toFixed(1)}m`
                    : '+0.0m'}
                </span>
                <span className="text-[10px] text-amber-400/80 block">Adjacent Lane/Shoulder</span>
              </div>
            </div>
          )}

          {/* Red Signal Occupancy Sensor Stop Badge */}
          {vehicle.activeLuaRule.includes('Red Signal') && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-2xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="font-semibold text-rose-300">Red-Light Stop Bar Hold</span>
              </div>
              <div className="font-mono text-rose-200 text-right">
                <span className="font-bold text-xs">52s Cycle Sensor Active</span>
                <span className="text-[10px] text-rose-400/80 block">Zero-Creep Hold Enforced</span>
              </div>
            </div>
          )}

          {/* Destination & Coordinates */}
          <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-400 space-y-1">
            <div className="flex items-center justify-between">
              <span>Target Artery:</span>
              <span className="text-slate-200">{vehicle.targetNodeId}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Grid Coordinates:</span>
              <span className="text-slate-200">
                [{vehicle.x.toFixed(1)}, {vehicle.z.toFixed(1)}]
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Discrete V2V Communication Journal */}
      {activeTab === 'v2v' && (
        <div className="flex-1 p-3 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
            <span>Direct Mesh Exchange Feed</span>
            <span className="font-mono text-cyan-400">V2V Channel: 5.9 GHz DSRC</span>
          </div>

          {(!vehicle.v2vJournal || vehicle.v2vJournal.length === 0) ? (
            <div className="text-slate-500 text-xs text-center py-8">
              No recent packets exchanged. Vehicle in free-flow state.
            </div>
          ) : (
            vehicle.v2vJournal.map((msg) => {
              const isTx = msg.direction === 'TX';
              const isEmergencyMsg = msg.type === 'EMERGENCY_CLEAR';
              const isHazard = msg.type === 'HAZARD_ALERT';
              const isYield = msg.type === 'RIGHT_OF_WAY_YIELD';
              const isCascade = msg.type === 'TRAFFIC_JAM_CASCADE' || msg.type === 'TRAFFIC_JAM_SHOCKWAVE';

              return (
                <div
                  key={msg.id}
                  className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {isTx ? (
                        <span className="flex items-center gap-1 text-cyan-400 font-mono text-[10px] bg-cyan-950/60 px-1.5 py-0.5 rounded">
                          <ArrowUpRight className="w-3 h-3" /> TX → {msg.counterpartId}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-indigo-400 font-mono text-[10px] bg-indigo-950/60 px-1.5 py-0.5 rounded">
                          <ArrowDownLeft className="w-3 h-3" /> RX ← {msg.counterpartId}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{msg.timestamp}</span>
                  </div>

                  <div className="text-[11px] text-slate-200 font-mono leading-tight">
                    <span
                      className={`font-semibold mr-1.5 ${
                        isEmergencyMsg
                          ? 'text-rose-400'
                          : isCascade
                          ? 'text-orange-400'
                          : isHazard
                          ? 'text-amber-400'
                          : isYield
                          ? 'text-yellow-300'
                          : 'text-cyan-300'
                      }`}
                    >
                      [{msg.type}]
                    </span>
                    {msg.content}
                  </div>

                  <div className="text-[10px] text-emerald-400/90 font-sans italic bg-slate-900/50 px-2 py-0.5 rounded">
                    Action: {msg.negotiatedAction}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 3: Active Lua Behavior Logic */}
      {activeTab === 'lua' && (
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Active Governing Rule</span>
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 rounded-full">
                Active
              </span>
            </div>
            <div className="text-sm font-semibold text-slate-100">
              {vehicle.activeLuaRule}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              This entity's throttle, braking envelope, and conflict yields are dynamically modulated
              in real-time via the in-browser Lua interpreter hook.
            </p>
          </div>

          <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-2xl text-xs space-y-2">
            <span className="text-slate-400 block font-medium">Lua Variable State:</span>
            <div className="font-mono text-[11px] text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">vehicle:get_speed():</span>
                <span className="text-cyan-300">{speedKmh} km/h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">vehicle:get_priority():</span>
                <span className="text-cyan-300">{vehicle.priority}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">avoidance_distance:</span>
                <span className="text-cyan-300">{vehicle.avoidanceRadius.toFixed(1)}m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">v2v_mesh_neighbors:</span>
                <span className="text-indigo-300">{vehicle.v2vNeighbors?.length || 2} nodes</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
