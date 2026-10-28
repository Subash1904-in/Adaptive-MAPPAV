/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Activity, Car, Zap, ShieldAlert, Crosshair, X } from 'lucide-react';
import { SimulationEngine } from '../simulation/simulationEngine';
import { IncidentPlaceType } from './SimulationViewport';
import { LiveBackendBridge } from './LiveBackendBridge';

interface MinimalHUDProps {
  engine: SimulationEngine | null;
  fps: number;
  incidentPlaceMode: IncidentPlaceType;
  showHeatmap?: boolean;
  onCancelIncidentPlace: () => void;
  selectedVehicleId: string | null;
  onDeselectVehicle: () => void;
}

export const MinimalHUD: React.FC<MinimalHUDProps> = ({
  engine,
  fps,
  incidentPlaceMode,
  showHeatmap = false,
  onCancelIncidentPlace,
  selectedVehicleId,
  onDeselectVehicle,
}) => {
  const metrics = engine?.metrics;
  const selectedVehicle = engine?.vehicles.find((v) => v.id === selectedVehicleId);

  return (
    <div className="fixed top-0 left-0 right-0 z-20 p-4 pointer-events-none flex flex-col gap-2">
      {/* Top Bar Contract (1 Row, 3 Zones) */}
      <header className="flex items-center justify-between gap-8 pointer-events-auto">
        {/* Zone 1: Single Brand Wordmark */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 border border-slate-800 rounded-xl backdrop-blur-md shadow-lg">
            <span className="text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap">
              Adaptive MAPF
            </span>
            <span className="text-slate-600">/</span>
            <span className="text-xs font-medium text-cyan-400 capitalize whitespace-nowrap">
              {engine?.currentScenario.replace('_', ' ') || 'Rush Hour'}
            </span>
          </div>
        </div>

        {/* Zone 2: Clean unboxed metadata telemetry metrics */}
        <div className="hidden md:flex items-center gap-4 px-4 py-1.5 bg-slate-900/80 border border-slate-800/80 rounded-xl backdrop-blur-md text-xs font-mono text-slate-300 shadow-md">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="tabular-nums font-semibold">{fps}</span>
            <span className="text-slate-500 font-sans">FPS</span>
          </div>

          <span className="text-slate-700" aria-hidden="true">·</span>

          <div className="flex items-center gap-1.5">
            <Car className="w-3.5 h-3.5 text-cyan-400" />
            <span className="tabular-nums font-semibold">
              {metrics?.activeVehicles ?? 0}
            </span>
            <span className="text-slate-500 font-sans">Agents</span>
          </div>

          <span className="text-slate-700" aria-hidden="true">·</span>

          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-indigo-400" />
            <span className="tabular-nums font-semibold">
              {metrics?.v2vPacketsPerSec ?? 0}
            </span>
            <span className="text-slate-500 font-sans">V2V/s</span>
          </div>

          <span className="text-slate-700" aria-hidden="true">·</span>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-sans">Throughput:</span>
            <span className="tabular-nums font-semibold text-emerald-300">
              {metrics?.throughputPerMin ?? 0}
            </span>
            <span className="text-slate-500 font-sans">v/m</span>
          </div>
        </div>

        {/* Zone 3: Live Backend Connection & Helper Hints */}
        <div className="flex items-center gap-3">
          <LiveBackendBridge engine={engine} />
        </div>
      </header>

      {/* Heatmap Layer Legend */}
      {showHeatmap && (
        <div className="self-center pointer-events-auto flex items-center gap-4 px-3.5 py-1.5 bg-slate-900/90 border border-slate-700/80 rounded-xl text-[11px] font-mono text-slate-300 shadow-xl backdrop-blur-md animate-fadeIn">
          <span className="font-sans font-semibold text-slate-400">V2V Density:</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <span>Low (Flow)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>Medium</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-rose-300 font-semibold">High Bottleneck</span>
          </div>
        </div>
      )}

      {/* Incident Placement Reticle Notice */}
      {incidentPlaceMode && (
        <div className="self-center pointer-events-auto flex items-center gap-3 px-4 py-2 bg-amber-950/90 border border-amber-500/60 text-amber-200 text-xs font-medium rounded-xl shadow-xl backdrop-blur-md animate-bounce">
          <Crosshair className="w-4 h-4 text-amber-400" />
          <span>
            Click on any road or intersection on the 3D map to deploy{' '}
            <strong className="uppercase">{incidentPlaceMode}</strong>
          </span>
          <button
            onClick={onCancelIncidentPlace}
            className="p-1 hover:bg-amber-900 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
