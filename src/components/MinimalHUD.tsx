/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Activity, Car, Zap, ShieldAlert, Crosshair, X, Sparkles, Gauge, Cpu, Shield } from 'lucide-react';
import { SimulationEngine } from '../simulation/simulationEngine';
import { IncidentPlaceType } from './SimulationViewport';
import { LiveBackendBridge } from './LiveBackendBridge';
import { GraphicsQuality } from '../types/simulation';

interface MinimalHUDProps {
  engine: SimulationEngine | null;
  fps: number;
  graphicsQuality?: GraphicsQuality;
  onCycleGraphicsQuality?: () => void;
  incidentPlaceMode: IncidentPlaceType;
  showHeatmap?: boolean;
  onCancelIncidentPlace: () => void;
  selectedVehicleId: string | null;
  onDeselectVehicle: () => void;
}

export const MinimalHUD: React.FC<MinimalHUDProps> = ({
  engine,
  fps,
  graphicsQuality = 'balanced',
  onCycleGraphicsQuality,
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
        {/* Zone 1: Single Brand Wordmark & AI Controller Badge */}
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

          {/* Multi-Agent AI Policy Controller Indicator */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border backdrop-blur-md shadow-lg text-xs font-mono transition-colors ${
              metrics?.aiTelemetry?.controller_mode === 'fallback'
                ? 'bg-slate-900/90 border-slate-700 text-slate-300'
                : 'bg-purple-950/90 border-purple-500/70 text-purple-200'
            }`}
            title={
              metrics?.aiTelemetry
                ? `Mode: ${metrics.aiTelemetry.controller_mode.toUpperCase()}\nModel: ${metrics.aiTelemetry.model_version} (${metrics.aiTelemetry.model_algorithm})\nSafety Interventions: ${metrics.aiTelemetry.total_safety_interventions}`
                : 'AI Policy Controller'
            }
          >
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-semibold text-slate-100">
              {metrics?.aiTelemetry?.controller_mode === 'fallback' ? 'Rule Fallback' : 'MAPPO AI'}
            </span>
            <span className="text-[10px] text-purple-300/80 font-sans">
              {metrics?.aiTelemetry?.model_version ? metrics.aiTelemetry.model_version.replace('curriculum_', 'v') : 'v1'}
            </span>
            {metrics?.aiTelemetry?.total_safety_interventions !== undefined && metrics.aiTelemetry.total_safety_interventions > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-rose-900/70 text-rose-200 rounded text-[9px] border border-rose-700/60 font-semibold" title="Safety Shield Interventions Prevented Invariants">
                🛡️ {metrics.aiTelemetry.total_safety_interventions}
              </span>
            )}
          </div>
        </div>

        {/* Zone 2: Clean unboxed metadata telemetry metrics */}
        <div className="hidden md:flex items-center gap-4 px-4 py-1.5 bg-slate-900/80 border border-slate-800/80 rounded-xl backdrop-blur-md text-xs font-mono text-slate-300 shadow-md">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="tabular-nums font-semibold">{fps}</span>
            <span className="text-slate-500 font-sans">FPS</span>
          </div>

          {onCycleGraphicsQuality && (
            <button
              onClick={onCycleGraphicsQuality}
              title={`Graphics Preset: ${graphicsQuality.toUpperCase()}. Click to cycle (Performance / Balanced / Ultra)`}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-mono transition-all cursor-pointer select-none ${
                graphicsQuality === 'performance'
                  ? 'bg-amber-950/70 border-amber-500/60 text-amber-300 hover:bg-amber-900/60 shadow-sm'
                  : graphicsQuality === 'ultra'
                  ? 'bg-purple-950/70 border-purple-500/60 text-purple-300 hover:bg-purple-900/60 shadow-sm'
                  : 'bg-cyan-950/70 border-cyan-500/60 text-cyan-300 hover:bg-cyan-900/60 shadow-sm'
              }`}
            >
              {graphicsQuality === 'performance' && <span>⚡ High FPS</span>}
              {graphicsQuality === 'balanced' && <span>⚖️ Balanced</span>}
              {graphicsQuality === 'ultra' && <span>✨ Ultra</span>}
            </button>
          )}

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
