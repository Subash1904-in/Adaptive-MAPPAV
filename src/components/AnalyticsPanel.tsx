/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Download,
  Activity,
  Zap,
  TrendingUp,
  AlertOctagon,
  Clock,
  Car,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import { SimulationEngine } from '../simulation/simulationEngine';

interface AnalyticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  engine: SimulationEngine | null;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ isOpen, onClose, engine }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeTab, setActiveTab] = useState<'analytics' | 'emergency'>('analytics');
  const [activeLayers, setActiveLayers] = useState({
    throughput: true,
    delay: true,
    v2v: true,
    risk: true,
  });

  // Render multi-layered time-series graph
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !engine || activeTab !== 'analytics') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const history = engine.metricsHistory;
    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    // Draw subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let y = 40; y < height - 30; y += 40) {
      ctx.beginPath();
      ctx.moveTo(50, y);
      ctx.lineTo(width - 20, y);
      ctx.stroke();
    }

    if (history.length < 2) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Accumulating real-time telemetry...', width / 2, height / 2);
      return;
    }

    const padLeft = 60;
    const padRight = 20;
    const padTop = 30;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const n = history.length;
    const stepX = plotW / (n - 1);

    // Layer 1: V2V Packet Rate (Subtle indigo vertical bars)
    if (activeLayers.v2v) {
      const maxPackets = Math.max(10, ...history.map((h) => h.v2vPackets));
      ctx.fillStyle = 'rgba(99, 102, 241, 0.22)';
      for (let i = 0; i < n; i++) {
        const x = padLeft + i * stepX;
        const barH = (history[i].v2vPackets / maxPackets) * plotH * 0.85;
        ctx.fillRect(x - 2, height - padBottom - barH, 4, barH);
      }
    }

    // Layer 2: Throughput (Cyan line)
    if (activeLayers.throughput) {
      const maxTp = Math.max(30, ...history.map((h) => h.throughput));
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = padLeft + i * stepX;
        const y = height - padBottom - (history[i].throughput / maxTp) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Layer 3: Average Delay (Amber line)
    if (activeLayers.delay) {
      const maxDelay = Math.max(10, ...history.map((h) => h.delay));
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = padLeft + i * stepX;
        const y = height - padBottom - (history[i].delay / maxDelay) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Layer 4: Collision Risk Index (Crimson line with glowing dots)
    if (activeLayers.risk) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = padLeft + i * stepX;
        const y = height - padBottom - history[i].collisionRisk * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Axes and labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('100%', padLeft - 8, padTop + 8);
    ctx.fillText('50%', padLeft - 8, padTop + plotH / 2);
    ctx.fillText('0%', padLeft - 8, height - padBottom);

    ctx.textAlign = 'center';
    ctx.fillText('Historical Simulation Window (Last 60s)', width / 2, height - 12);
  }, [isOpen, engine, activeLayers, activeTab]);

  if (!isOpen || !engine) return null;

  const metrics = engine.metrics;
  const emMetrics = metrics.emergencyMetrics;
  const vehicles = engine.vehicles;

  // Emergency fleet vehicles
  const emergencyFleet = vehicles.filter((v) =>
    ['police', 'ambulance', 'fire_engine', 'emergency', 'vip_limo'].includes(v.type)
  );

  // Fleet status calculations
  const cruising = vehicles.filter((v) => v.status === 'cruising').length;
  const yielding = vehicles.filter((v) => v.status === 'yielding').length;
  const rerouting = vehicles.filter((v) => v.status === 'rerouting').length;
  const braking = vehicles.filter((v) => v.status === 'braking' || v.status === 'stopped').length;
  const totalVeh = Math.max(1, vehicles.length);

  /**
   * Export multi-layer chart canvas as high-resolution PNG image
   */
  const handleExportChartPng = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `MAPF_MultiLayer_Chart_${Date.now()}.png`;
    link.href = url;
    link.click();
  };

  /**
   * Download metrics history as CSV
   */
  const handleExportHistoryCsv = () => {
    let csv =
      'timestamp_sec,throughput_veh_min,avg_speed_kmh,delay_sec,v2v_packets_sec,collision_risk,preemption_success_pct,avoidance_latency_ms\n';
    for (const h of engine.metricsHistory) {
      csv += `${h.time},${h.throughput},${h.avgSpeed},${h.delay},${h.v2vPackets},${h.collisionRisk},${emMetrics.preemptionSuccessRate},${emMetrics.avgAvoidanceLatencyMs}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `MAPF_Simulation_Telemetry_${Date.now()}.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Export Emergency Fleet Status as JSON
   */
  const handleExportEmergencyReportJson = () => {
    const report = {
      timestamp: new Date().toISOString(),
      scenario: engine.currentScenario,
      simTimeSeconds: metrics.simTimeSeconds,
      metrics: {
        preemptionSuccessRate: emMetrics.preemptionSuccessRate,
        avgAvoidanceLatencyMs: emMetrics.avgAvoidanceLatencyMs,
        corridorClearanceRate: emMetrics.corridorClearanceRate,
        greenWaveIntersections: emMetrics.greenWaveIntersectionsCount,
        civilianYieldCount: emMetrics.civilianYieldCount,
        totalEvents: emMetrics.totalPreemptionEvents,
      },
      emergencyVehicles: emergencyFleet.map((v) => ({
        id: v.id,
        type: v.type,
        speedKmh: Math.round(v.speed * 3.6),
        targetSpeedKmh: Math.round(v.targetSpeed * 3.6),
        priority: v.priority,
        status: v.status,
        activeLuaRule: v.activeLuaRule,
        recentV2V: v.v2vJournal?.slice(0, 3) || [],
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `MAPF_Emergency_Traffic_Status_${Date.now()}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 p-1 bg-slate-950/80 border border-slate-800 rounded-xl">
              <button
                onClick={() => setActiveTab('analytics')}
                className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'analytics'
                    ? 'bg-slate-800 text-cyan-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Multi-Layer Telemetry</span>
              </button>

              <button
                onClick={() => setActiveTab('emergency')}
                className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  activeTab === 'emergency'
                    ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>Emergency Traffic Status</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {emergencyFleet.length} Units
                </span>
              </button>
            </div>

            <div className="hidden md:block text-xs text-slate-400 font-mono">
              Scenario: <strong className="text-slate-200">{engine.currentScenario.toUpperCase()}</strong> · Sim Time:{' '}
              {Math.round(metrics.simTimeSeconds)}s
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'analytics' ? (
              <>
                <button
                  onClick={handleExportChartPng}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-200 bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-700/60 rounded-xl transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Chart PNG</span>
                </button>

                <button
                  onClick={handleExportHistoryCsv}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-200 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-700/60 rounded-xl transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleExportEmergencyReportJson}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-200 bg-rose-950/50 hover:bg-rose-900/60 border border-rose-700/60 rounded-xl transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Emergency JSON</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'analytics' ? (
            <>
              {/* KPI Cards Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">Throughput</span>
                    <TrendingUp className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                    {metrics.throughputPerMin}
                    <span className="text-xs text-slate-500 font-sans ml-1">veh/min</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">Avg Delay</span>
                    <Clock className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                    {metrics.avgDelaySeconds}
                    <span className="text-xs text-slate-500 font-sans ml-1">sec</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">V2V Exchange</span>
                    <Zap className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                    {metrics.v2vPacketsPerSec}
                    <span className="text-xs text-slate-500 font-sans ml-1">pkts/sec</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">Collision Risk</span>
                    <AlertOctagon className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-100">
                    {metrics.collisionRiskIndex}
                    <span className="text-xs text-slate-500 font-sans ml-1">index</span>
                  </div>
                </div>
              </div>

              {/* Multi-Layer Canvas Chart */}
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Multi-Layer Telemetry Dynamics
                  </div>

                  {/* Layer Visibility Toggles */}
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer text-cyan-300">
                      <input
                        type="checkbox"
                        checked={activeLayers.throughput}
                        onChange={(e) =>
                          setActiveLayers({ ...activeLayers, throughput: e.target.checked })
                        }
                        className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                      />
                      <span>Throughput</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer text-amber-300">
                      <input
                        type="checkbox"
                        checked={activeLayers.delay}
                        onChange={(e) =>
                          setActiveLayers({ ...activeLayers, delay: e.target.checked })
                        }
                        className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
                      />
                      <span>Avg Delay</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer text-indigo-300">
                      <input
                        type="checkbox"
                        checked={activeLayers.v2v}
                        onChange={(e) =>
                          setActiveLayers({ ...activeLayers, v2v: e.target.checked })
                        }
                        className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0"
                      />
                      <span>V2V Volume</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer text-rose-300">
                      <input
                        type="checkbox"
                        checked={activeLayers.risk}
                        onChange={(e) =>
                          setActiveLayers({ ...activeLayers, risk: e.target.checked })
                        }
                        className="rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-0"
                      />
                      <span>Collision Risk</span>
                    </label>
                  </div>
                </div>

                <canvas
                  ref={canvasRef}
                  width={900}
                  height={260}
                  className="w-full h-64 rounded-xl border border-slate-800/80 bg-[#090d16]"
                />
              </div>

              {/* Fleet Status Distribution Strip */}
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
                <div className="text-xs font-semibold text-slate-300 mb-2">
                  Autonomous Fleet Coordination States ({vehicles.length} Vehicles)
                </div>

                {/* Segmented Progress Bar */}
                <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex">
                  <div
                    style={{ width: `${(cruising / totalVeh) * 100}%` }}
                    className="bg-emerald-500 transition-all duration-300"
                    title={`Cruising: ${cruising}`}
                  />
                  <div
                    style={{ width: `${(yielding / totalVeh) * 100}%` }}
                    className="bg-amber-500 transition-all duration-300"
                    title={`Yielding: ${yielding}`}
                  />
                  <div
                    style={{ width: `${(rerouting / totalVeh) * 100}%` }}
                    className="bg-cyan-500 transition-all duration-300"
                    title={`Rerouting: ${rerouting}`}
                  />
                  <div
                    style={{ width: `${(braking / totalVeh) * 100}%` }}
                    className="bg-rose-500 transition-all duration-300"
                    title={`Braking: ${braking}`}
                  />
                </div>

                <div className="flex items-center justify-between mt-3 text-xs text-slate-400 font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span>
                      Cruising: {cruising} ({Math.round((cruising / totalVeh) * 100)}%)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span>
                      Yielding: {yielding} ({Math.round((yielding / totalVeh) * 100)}%)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
                    <span>
                      Rerouting: {rerouting} ({Math.round((rerouting / totalVeh) * 100)}%)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span>
                      Braking: {braking} ({Math.round((braking / totalVeh) * 100)}%)
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Emergency Traffic Status Panel */
            <div className="space-y-6">
              {/* Top Emergency KPI Deck */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">V2V Preemption Rate</span>
                    <Zap className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-rose-400">
                    {emMetrics.preemptionSuccessRate.toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-emerald-400 font-sans mt-1">
                    ✓ High-confidence corridor reservation
                  </div>
                </div>

                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">Avoidance Latency</span>
                    <Activity className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-cyan-300">
                    {Math.round(emMetrics.avgAvoidanceLatencyMs)}
                    <span className="text-xs text-slate-500 font-sans ml-1">ms</span>
                  </div>
                  <div className="text-[11px] text-cyan-400/80 font-sans mt-1">
                    IEEE 802.11p ultra-low latency
                  </div>
                </div>

                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">Corridor Clearance</span>
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
                    {emMetrics.corridorClearanceRate.toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-slate-400 font-sans mt-1">
                    Adjacent lane & shoulder evacuation
                  </div>
                </div>

                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-xs font-medium">Green-Wave Intersections</span>
                    <AlertOctagon className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-indigo-300">
                    {emMetrics.greenWaveIntersectionsCount}
                    <span className="text-xs text-slate-500 font-sans ml-1">nodes</span>
                  </div>
                  <div className="text-[11px] text-indigo-400/80 font-sans mt-1">
                    {emMetrics.civilianYieldCount} civilian yields logged
                  </div>
                </div>
              </div>

              {/* Emergency Fleet Table */}
              <div className="p-5 bg-slate-950/70 border border-slate-800 rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                    <h3 className="text-sm font-semibold text-slate-200">
                      Active Emergency Vehicle Fleet ({emergencyFleet.length} Units)
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    Dynamic V2V & V2I Priority Level 8–10
                  </span>
                </div>

                {emergencyFleet.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs">
                    No active emergency vehicles in current scenario. Switch to 'Police Pursuit' or 'Multi-Vehicle Emergency Response'.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 font-medium">
                          <th className="pb-2.5 pl-2">Unit</th>
                          <th className="pb-2.5">Type</th>
                          <th className="pb-2.5">Priority</th>
                          <th className="pb-2.5">Velocity</th>
                          <th className="pb-2.5">Status</th>
                          <th className="pb-2.5">Active Lua Policy</th>
                          <th className="pb-2.5 pr-2">Latest V2V Negotiation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {emergencyFleet.map((v) => {
                          const speed = Math.round(v.speed * 3.6);
                          const lastV2V = v.v2vJournal?.[0];

                          return (
                            <tr key={v.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-2.5 pl-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: v.color }}
                                  />
                                  <span className="text-slate-200 font-semibold">{v.id}</span>
                                </div>
                              </td>
                              <td className="py-2.5 text-slate-300 font-sans capitalize">
                                {v.type.replace('_', ' ')}
                              </td>
                              <td className="py-2.5">
                                <span className="px-2 py-0.5 rounded-md bg-rose-950/80 text-rose-300 border border-rose-800/70">
                                  {v.priority}/10
                                </span>
                              </td>
                              <td className="py-2.5 text-cyan-300 tabular-nums">
                                {speed} km/h
                              </td>
                              <td className="py-2.5">
                                <span className="capitalize text-emerald-400 font-sans">
                                  {v.status}
                                </span>
                              </td>
                              <td className="py-2.5 text-slate-300 font-sans">
                                {v.activeLuaRule}
                              </td>
                              <td className="py-2.5 pr-2 text-slate-400 font-sans max-w-xs truncate">
                                {lastV2V ? (
                                  <span title={`${lastV2V.type}: ${lastV2V.content}`}>
                                    <strong className="text-cyan-400">[{lastV2V.direction}]</strong> {lastV2V.negotiatedAction}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">Broadcasting corridor beacons</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* V2V & Traffic Light Safety Protocol Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl text-xs space-y-2">
                  <div className="font-semibold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>52-Second Strict Signal Cycle</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Strict 52.0s 6-phase FSM: 20s NS Green, 4s NS Yellow, 2s All-Red clearance, 20s EW Green, 4s EW Yellow, 2s All-Red clearance. Grid coordination alternates 0s and 26s half-cycle phases across nodes.
                  </p>
                </div>

                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl text-xs space-y-2">
                  <div className="font-semibold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span>Red-Light Occupancy Sensors</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Dual-zone sensing: advance sensors (34m) trigger progressive speed reduction down to 0.6 m/s, while stop-bar induction loops (7.5m) lock queued vehicles in complete stop until green release.
                  </p>
                </div>

                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl text-xs space-y-2">
                  <div className="font-semibold text-slate-200 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>V2I Preemption & V2V Clearance</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Approaching emergency responders broadcast siren beacons triggering immediate green-wave preemption and prompting civilian vehicles to calculate +2.4m lateral shoulder shifts.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

