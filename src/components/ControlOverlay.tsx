/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Car,
  AlertTriangle,
  FileDown,
  Layers,
  Code2,
  Eye,
  Sun,
  Moon,
  Compass,
  ChevronDown,
  ChevronUp,
  XCircle,
  Radio,
  SlidersHorizontal,
  Shield,
  Flame,
  ShieldAlert,
  Activity,
  Cpu,
} from 'lucide-react';
import { ScenarioType, Incident, GraphicsQuality, ControllerMode } from '../types/simulation';
import { CameraMode, IncidentPlaceType } from './SimulationViewport';
import { SCENARIOS } from '../simulation/scenarios';

interface ControlOverlayProps {
  currentScenario: ScenarioType;
  onScenarioChange: (scenario: ScenarioType) => void;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  graphicsQuality?: GraphicsQuality;
  onGraphicsQualityChange?: (quality: GraphicsQuality) => void;
  controllerMode?: ControllerMode;
  onControllerModeChange?: (mode: ControllerMode) => void;
  showV2VLinks: boolean;
  onToggleV2VLinks: () => void;
  showPaths: boolean;
  onTogglePaths: () => void;
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  isNightMode: boolean;
  onToggleNightMode: () => void;
  incidentPlaceMode: IncidentPlaceType;
  onSelectIncidentPlaceMode: (type: IncidentPlaceType) => void;
  onClearAllIncidents: () => void;
  incidentCount: number;
  onOpenAnalytics: () => void;
  onOpenLuaDrawer: () => void;
  onExportLogs: (format: 'csv' | 'json') => void;
}

export const ControlOverlay: React.FC<ControlOverlayProps> = ({
  currentScenario,
  onScenarioChange,
  cameraMode,
  onCameraModeChange,
  graphicsQuality = 'balanced',
  onGraphicsQualityChange,
  controllerMode = 'ai',
  onControllerModeChange,
  showV2VLinks,
  onToggleV2VLinks,
  showPaths,
  onTogglePaths,
  showHeatmap,
  onToggleHeatmap,
  isNightMode,
  onToggleNightMode,
  incidentPlaceMode,
  onSelectIncidentPlaceMode,
  onClearAllIncidents,
  incidentCount,
  onOpenAnalytics,
  onOpenLuaDrawer,
  onExportLogs,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'scenarios' | 'incidents' | 'view'>('scenarios');
  const [showExportMenu, setShowExportMenu] = useState(false);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-4xl px-4 pointer-events-none">
      <div className="flex flex-col items-center">
        {/* Collapse / Expand Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 mb-1.5 text-xs font-medium text-slate-300 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/70 rounded-full shadow-lg transition-colors cursor-pointer"
        >
          {isCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        {/* Unified Bottom Dock */}
        {!isCollapsed && (
          <div className="pointer-events-auto w-full bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md p-3.5 transition-all">
            {/* Top Sub-Bar: Navigation Tabs & Tool Triggers */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80 gap-2 flex-wrap">
              {/* Category Segmented Tabs */}
              <div className="flex items-center gap-1 p-1 bg-slate-950/70 border border-slate-800 rounded-xl">
                <button
                  onClick={() => setActiveTab('scenarios')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'scenarios'
                      ? 'bg-slate-800 text-cyan-400 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Car className="w-3.5 h-3.5" />
                  <span>Scenarios</span>
                </button>

                <button
                  onClick={() => setActiveTab('incidents')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'incidents'
                      ? 'bg-slate-800 text-amber-400 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Incidents ({incidentCount})</span>
                </button>

                <button
                  onClick={() => setActiveTab('view')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'view'
                      ? 'bg-slate-800 text-slate-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Display & Camera</span>
                </button>
              </div>

              {/* Quick Action Buttons (Analytics, Lua IDE, Export) */}
              <div className="flex items-center gap-2">
                <button
                  onClick={onOpenAnalytics}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-colors cursor-pointer"
                  title="Toggle Analytics Dashboard (Tab / D)"
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Analytics</span>
                  <span className="text-[10px] text-slate-400 ml-0.5">Tab</span>
                </button>

                <button
                  onClick={onOpenLuaDrawer}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-colors cursor-pointer"
                  title="Open Lua Script Console (L)"
                >
                  <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Lua Scripts</span>
                  <span className="text-[10px] text-slate-400 ml-0.5">L</span>
                </button>

                {/* Export Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-xl transition-colors cursor-pointer"
                  >
                    <FileDown className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Export Logs</span>
                  </button>

                  {showExportMenu && (
                    <div className="absolute right-0 bottom-full mb-2 w-44 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-1.5 z-30">
                      <button
                        onClick={() => {
                          onExportLogs('csv');
                          setShowExportMenu(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        Download Telemetry (CSV)
                      </button>
                      <button
                        onClick={() => {
                          onExportLogs('json');
                          setShowExportMenu(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        Full Session Dump (JSON)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tab Contents */}
            {activeTab === 'scenarios' && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {(Object.keys(SCENARIOS) as ScenarioType[]).map((scId) => {
                  const sc = SCENARIOS[scId];
                  const isActive = currentScenario === scId;
                  const isEmerg = ['police_pursuit', 'fire_rescue', 'vip_motorcade', 'emergency_corridor'].includes(scId);

                  return (
                    <button
                      key={scId}
                      onClick={() => onScenarioChange(scId)}
                      className={`flex items-start gap-2 px-3 py-2 text-xs font-medium rounded-xl border text-left whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                        isActive
                          ? isEmerg
                            ? 'bg-rose-500/15 border-rose-500/70 text-rose-200 shadow-sm'
                            : 'bg-cyan-500/15 border-cyan-500/60 text-cyan-200 shadow-sm'
                          : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="pt-0.5">
                        {scId === 'fire_rescue' ? (
                          <Flame className="w-3.5 h-3.5 text-orange-400" />
                        ) : scId === 'vip_motorcade' ? (
                          <Shield className="w-3.5 h-3.5 text-indigo-400" />
                        ) : isEmerg ? (
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <Car className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </div>
                      <div>
                        <div className="font-semibold">{sc.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {sc.vehicleCount} vehicles {isEmerg ? '· High Priority' : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'incidents' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2.5 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 font-medium">Place on Road:</span>

                    <button
                      onClick={() =>
                        onSelectIncidentPlaceMode(
                          incidentPlaceMode === 'accident' ? null : 'accident'
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                        incidentPlaceMode === 'accident'
                          ? 'bg-rose-500/20 border-rose-500 text-rose-300 ring-2 ring-rose-500/40'
                          : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                      }`}
                      title="Two collided damaged vehicles with smoke particles and road blockage"
                    >
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>+ Vehicle Crash</span>
                    </button>

                    <button
                      onClick={() =>
                        onSelectIncidentPlaceMode(
                          incidentPlaceMode === 'traffic_jam' ? null : 'traffic_jam'
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                        incidentPlaceMode === 'traffic_jam'
                          ? 'bg-purple-500/20 border-purple-500 text-purple-300 ring-2 ring-purple-500/40'
                          : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                      }`}
                      title="Shockwave bottleneck slowdown with upstream V2V rerouting"
                    >
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                      <span>+ Traffic Jam</span>
                    </button>

                    <button
                      onClick={() =>
                        onSelectIncidentPlaceMode(
                          incidentPlaceMode === 'roadblock' ? null : 'roadblock'
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                        incidentPlaceMode === 'roadblock'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-200 ring-2 ring-amber-500/40'
                          : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                      }`}
                      title="Police cordon roadblock with full arterial detour"
                    >
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>+ Roadblock</span>
                    </button>

                    <button
                      onClick={() =>
                        onSelectIncidentPlaceMode(
                          incidentPlaceMode === 'construction' ? null : 'construction'
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                        incidentPlaceMode === 'construction'
                          ? 'bg-orange-500/20 border-orange-500 text-orange-200 ring-2 ring-orange-500/40'
                          : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                      }`}
                      title="Utility roadwork cones and speed restriction"
                    >
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      <span>+ Work Zone</span>
                    </button>

                    <button
                      onClick={() =>
                        onSelectIncidentPlaceMode(
                          incidentPlaceMode === 'hazard' ? null : 'hazard'
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                        incidentPlaceMode === 'hazard'
                          ? 'bg-red-500/20 border-red-500 text-red-200 ring-2 ring-red-500/40'
                          : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                      }`}
                      title="Emergency flare hazard perimeter"
                    >
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span>+ Hazard Flare</span>
                    </button>
                  </div>

                  {incidentCount > 0 && (
                    <button
                      onClick={onClearAllIncidents}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/60 rounded-xl transition-colors cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span>Clear All ({incidentCount})</span>
                    </button>
                  )}
                </div>

                {incidentPlaceMode && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-cyan-950/40 border border-cyan-800/50 rounded-xl text-xs text-cyan-300 animate-pulse">
                    <span>
                      🎯 Click anywhere on the road grid to deploy{' '}
                      <strong>{incidentPlaceMode.replace('_', ' ').toUpperCase()}</strong>
                    </span>
                    <button
                      onClick={() => onSelectIncidentPlaceMode(null)}
                      className="text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'view' && (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                {/* Camera Presets */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400 mr-1">Camera:</span>
                  <button
                    onClick={() => onCameraModeChange('orbit')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      cameraMode === 'orbit'
                        ? 'bg-slate-800 border-cyan-500 text-cyan-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    3D Orbit
                  </button>
                  <button
                    onClick={() => onCameraModeChange('top_down')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      cameraMode === 'top_down'
                        ? 'bg-slate-800 border-cyan-500 text-cyan-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Top-Down 2D
                  </button>
                </div>

                {/* Graphics Quality Presets for Maintaining FPS */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400 mr-1">Graphics:</span>
                  <button
                    onClick={() => onGraphicsQualityChange?.('performance')}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      graphicsQuality === 'performance'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 ring-1 ring-amber-500/40'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title="Performance: Shadows OFF, 1.0x DPR (Recommended for 60+ FPS on low-power devices)"
                  >
                    <span>⚡ High FPS</span>
                  </button>
                  <button
                    onClick={() => onGraphicsQualityChange?.('balanced')}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      graphicsQuality === 'balanced'
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 ring-1 ring-cyan-500/40'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title="Balanced: 1024 Shadows, 1.25x DPR, Smooth 60 FPS"
                  >
                    <span>⚖️ Balanced</span>
                  </button>
                  <button
                    onClick={() => onGraphicsQualityChange?.('ultra')}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      graphicsQuality === 'ultra'
                        ? 'bg-purple-500/20 border-purple-500 text-purple-300 ring-1 ring-purple-500/40'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title="Ultra: 2048 Soft Shadows, Native High-DPI, HDR Reflections"
                  >
                    <span>✨ Ultra</span>
                  </button>
                </div>

                {/* Primary AI Controller Mode */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400 mr-1">Control:</span>
                  <button
                    onClick={() => onControllerModeChange?.(controllerMode === 'ai' ? 'fallback' : 'ai')}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      controllerMode === 'ai'
                        ? 'bg-purple-500/20 border-purple-500 text-purple-300 ring-1 ring-purple-500/40'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    title={
                      controllerMode === 'ai'
                        ? 'Primary Controller: Multi-Agent Neural Policy (MAPPO-CTDE). Click to switch to Rule Fallback.'
                        : 'Primary Controller: Deterministic Rule Fallback. Click to enable Trained MAPPO AI.'
                    }
                  >
                    <Cpu className="w-3.5 h-3.5 text-purple-400" />
                    <span>{controllerMode === 'ai' ? '🤖 MAPPO AI' : '🛡️ Rule Fallback'}</span>
                  </button>
                </div>

                {/* Overlays and Lighting */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={onToggleV2VLinks}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      showV2VLinks
                        ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>V2V Beams</span>
                  </button>

                  <button
                    onClick={onToggleHeatmap}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      showHeatmap
                        ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400'
                    }`}
                    title="Toggle V2V Communication Density Heatmap Layer"
                  >
                    <Activity className="w-3.5 h-3.5 text-rose-400" />
                    <span>Heatmap Layer</span>
                  </button>

                  <button
                    onClick={onTogglePaths}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      showPaths
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400'
                    }`}
                    title="Toggle Floating Glowing Trajectory Ribbons"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Trajectory Ribbons</span>
                  </button>

                  <button
                    onClick={onToggleNightMode}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      isNightMode
                        ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400'
                    }`}
                  >
                    {isNightMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                    <span>{isNightMode ? 'Night Lights' : 'Day Sun'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
