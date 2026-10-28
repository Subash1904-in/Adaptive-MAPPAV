/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { SimulationEngine } from './simulation/simulationEngine';
import { LuaEngine } from './simulation/luaEngine';
import { SimulationViewport, CameraMode, IncidentPlaceType } from './components/SimulationViewport';
import { ControlOverlay } from './components/ControlOverlay';
import { MinimalHUD } from './components/MinimalHUD';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { LuaScriptDrawer } from './components/LuaScriptDrawer';
import { VehicleInspectorPopup } from './components/VehicleInspectorPopup';
import { OverheadV2VBubbles } from './components/OverheadV2VBubbles';
import { ScenarioType, GraphicsQuality } from './types/simulation';

export default function App() {
  const engineRef = useRef<SimulationEngine | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const luaEngine = useMemo(() => new LuaEngine(), []);

  const [currentScenario, setCurrentScenario] = useState<ScenarioType>('police_pursuit');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [graphicsQuality, setGraphicsQuality] = useState<GraphicsQuality>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('amapp_graphics_quality') : null;
    if (saved === 'performance' || saved === 'balanced' || saved === 'ultra') {
      return saved;
    }
    return 'balanced';
  });
  const [showV2VLinks, setShowV2VLinks] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isNightMode, setIsNightMode] = useState(false);
  const [incidentPlaceMode, setIncidentPlaceMode] = useState<IncidentPlaceType>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [isCameraFollowing, setIsCameraFollowing] = useState(true);
  const [incidentCount, setIncidentCount] = useState(0);

  // Panels & Overlays
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isLuaDrawerOpen, setIsLuaDrawerOpen] = useState(false);
  const [fps, setFps] = useState(60);

  // Sync incident count
  const syncIncidentCount = useCallback(() => {
    if (engineRef.current) {
      setIncidentCount(engineRef.current.incidents.length);
    }
  }, []);

  // Scenario switch handler
  const handleScenarioChange = useCallback(
    (scenario: ScenarioType) => {
      setCurrentScenario(scenario);
      if (engineRef.current) {
        engineRef.current.loadScenario(scenario);
        syncIncidentCount();
      }
    },
    [syncIncidentCount]
  );

  // Incident Placement callbacks
  const handleIncidentPlaced = useCallback(() => {
    setIncidentPlaceMode(null);
    syncIncidentCount();
  }, [syncIncidentCount]);

  const handleClearAllIncidents = useCallback(() => {
    if (engineRef.current) {
      const ids = engineRef.current.incidents.map((i) => i.id);
      ids.forEach((id) => engineRef.current?.removeIncident(id));
      syncIncidentCount();
    }
  }, [syncIncidentCount]);

  // Vehicle selection
  const handleVehicleSelected = useCallback((vehicleId: string | null) => {
    setSelectedVehicleId(vehicleId);
    if (vehicleId) {
      setIsCameraFollowing(true);
    }
  }, []);

  // Toggle helpers
  const handleToggleV2V = useCallback(() => {
    setShowV2VLinks((prev) => {
      const next = !prev;
      if (engineRef.current) engineRef.current.showV2VLinks = next;
      return next;
    });
  }, []);

  const handleTogglePaths = useCallback(() => {
    setShowPaths((prev) => {
      const next = !prev;
      if (engineRef.current) engineRef.current.showPathOverlays = next;
      return next;
    });
  }, []);

  const handleToggleHeatmap = useCallback(() => {
    setShowHeatmap((prev) => {
      const next = !prev;
      if (engineRef.current) engineRef.current.setHeatmapVisible(next);
      return next;
    });
  }, []);

  const handleGraphicsQualityChange = useCallback((quality: GraphicsQuality) => {
    setGraphicsQuality(quality);
    try {
      localStorage.setItem('amapp_graphics_quality', quality);
    } catch {
      // ignore
    }
  }, []);

  const handleCycleGraphicsQuality = useCallback(() => {
    setGraphicsQuality((prev) => {
      const next: GraphicsQuality =
        prev === 'performance' ? 'balanced' : prev === 'balanced' ? 'ultra' : 'performance';
      try {
        localStorage.setItem('amapp_graphics_quality', next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Export logs handler
  const handleExportLogs = useCallback((format: 'csv' | 'json') => {
    if (!engineRef.current) return;
    const content = engineRef.current.exportSimulationLogs(format);
    const mime = format === 'json' ? 'application/json' : 'text/csv';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `MAPF_Simulation_Logs_${Date.now()}.${format}`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'INPUT'
      ) {
        return;
      }

      if (e.key === 'Tab' || e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsAnalyticsOpen((prev) => !prev);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setIsLuaDrawerOpen((prev) => !prev);
      } else if (e.key.toLowerCase() === 'v') {
        handleToggleV2V();
      } else if (e.key.toLowerCase() === 'p') {
        handleTogglePaths();
      } else if (e.key.toLowerCase() === 'h') {
        handleToggleHeatmap();
      } else if (e.key === 'Escape') {
        setIsAnalyticsOpen(false);
        setIsLuaDrawerOpen(false);
        setIncidentPlaceMode(null);
        setSelectedVehicleId(null);
        if (engineRef.current) engineRef.current.selectedVehicleId = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleV2V, handleTogglePaths, handleToggleHeatmap]);

  const selectedVehicle = engineRef.current?.vehicles.find((v) => v.id === selectedVehicleId) || null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      {/* 3D WebGL Simulation Viewport (Takes Full Screen) */}
      <SimulationViewport
        engineRef={engineRef}
        luaEngine={luaEngine}
        cameraMode={cameraMode}
        graphicsQuality={graphicsQuality}
        isNightMode={isNightMode}
        incidentPlaceMode={incidentPlaceMode}
        isCameraFollowing={isCameraFollowing}
        externalCameraRef={cameraRef}
        onIncidentPlaced={handleIncidentPlaced}
        onVehicleSelected={handleVehicleSelected}
        onFpsUpdate={setFps}
      />

      {/* Floating Overhead V2V Micro-Bubbles */}
      <OverheadV2VBubbles
        engine={engineRef.current}
        cameraRef={cameraRef}
      />

      {/* Top Minimal Telemetry HUD with Heatmap Legend */}
      <MinimalHUD
        engine={engineRef.current}
        fps={fps}
        graphicsQuality={graphicsQuality}
        onCycleGraphicsQuality={handleCycleGraphicsQuality}
        incidentPlaceMode={incidentPlaceMode}
        showHeatmap={showHeatmap}
        onCancelIncidentPlace={() => setIncidentPlaceMode(null)}
        selectedVehicleId={selectedVehicleId}
        onDeselectVehicle={() => {
          setSelectedVehicleId(null);
          if (engineRef.current) engineRef.current.selectedVehicleId = null;
        }}
      />

      {/* Interactive Vehicle Inspection Popup */}
      {selectedVehicle && (
        <VehicleInspectorPopup
          vehicle={selectedVehicle}
          onClose={() => {
            setSelectedVehicleId(null);
            if (engineRef.current) engineRef.current.selectedVehicleId = null;
          }}
          isCameraFollowing={isCameraFollowing}
          onToggleCameraFollow={() => setIsCameraFollowing((prev) => !prev)}
        />
      )}

      {/* Collapsible Bottom Control Dock (Zero Viewport Occlusion) */}
      <ControlOverlay
        currentScenario={currentScenario}
        onScenarioChange={handleScenarioChange}
        cameraMode={cameraMode}
        onCameraModeChange={setCameraMode}
        graphicsQuality={graphicsQuality}
        onGraphicsQualityChange={handleGraphicsQualityChange}
        showV2VLinks={showV2VLinks}
        onToggleV2VLinks={handleToggleV2V}
        showPaths={showPaths}
        onTogglePaths={handleTogglePaths}
        showHeatmap={showHeatmap}
        onToggleHeatmap={handleToggleHeatmap}
        isNightMode={isNightMode}
        onToggleNightMode={() => setIsNightMode((prev) => !prev)}
        incidentPlaceMode={incidentPlaceMode}
        onSelectIncidentPlaceMode={setIncidentPlaceMode}
        onClearAllIncidents={handleClearAllIncidents}
        incidentCount={incidentCount}
        onOpenAnalytics={() => setIsAnalyticsOpen(true)}
        onOpenLuaDrawer={() => setIsLuaDrawerOpen(true)}
        onExportLogs={handleExportLogs}
      />

      {/* Analytics Panel Overlay (Hidden behind Tab / D toggle key) */}
      <AnalyticsPanel
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        engine={engineRef.current}
      />

      {/* Lua Behavior Scripting Drawer */}
      <LuaScriptDrawer
        isOpen={isLuaDrawerOpen}
        onClose={() => setIsLuaDrawerOpen(false)}
        luaEngine={luaEngine}
      />
    </div>
  );
}
