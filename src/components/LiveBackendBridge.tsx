/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, RefreshCw, Radio, Activity, Cpu } from 'lucide-react';
import { SimulationEngine } from '../simulation/simulationEngine';

interface LiveBackendBridgeProps {
  engine: SimulationEngine | null;
}

export const LiveBackendBridge: React.FC<LiveBackendBridgeProps> = ({ engine }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [wsUrl, setWsUrl] = useState('ws://localhost:8000/ws/sim/default/');
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [lastPacketTime, setLastPacketTime] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState<string>('police_pursuit');
  const wsRef = useRef<WebSocket | null>(null);

  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus('connecting');
    try {
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setStatus('connected');
        if (engine) engine.isWebSocketConnected = true;
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setPacketsReceived((prev) => prev + 1);
          setLastPacketTime(new Date().toTimeString().split(' ')[0]);

          if (payload.type === 'state' && payload.data && engine) {
            engine.applyBackendState(payload.data);
          } else if (payload.type === 'connected') {
            if (payload.scenario) setScenarioName(payload.scenario);
          }
        } catch {
          // ignore non-json ping packets
        }
      };

      socket.onerror = () => {
        setStatus('disconnected');
        if (engine) engine.isWebSocketConnected = false;
      };

      socket.onclose = () => {
        setStatus('disconnected');
        if (engine) engine.isWebSocketConnected = false;
      };

      wsRef.current = socket;
    } catch {
      setStatus('disconnected');
    }
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
    if (engine) engine.isWebSocketConnected = false;
  };

  // Auto-connect attempt on initial mount if Django backend is available
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="relative pointer-events-auto">
      {/* Status Pill in Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors cursor-pointer"
        title="Django + DRF + Channels Live Backend Stream"
      >
        {status === 'connected' ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-emerald-300 font-mono">Django Live (30Hz)</span>
          </>
        ) : status === 'connecting' ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span className="text-amber-300">Connecting Backend...</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Embedded Sim Fallback</span>
          </>
        )}
      </button>

      {/* Configuration Popover */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-84 p-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-50 text-slate-200">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-semibold text-slate-100">
                Django Sim Engine Bridge
              </h4>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 font-mono">
              Channels WS
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                WebSocket Stream URL
              </label>
              <input
                type="text"
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                placeholder="ws://localhost:8000/ws/sim/default/"
                className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>Simulation Backend:</span>
                <span className="font-semibold text-slate-200 capitalize">
                  {status === 'connected' ? 'Python / Django Channels' : 'Client-Side (Local Fallback)'}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Packets Received:</span>
                <span className="font-mono text-cyan-400 font-semibold">{packetsReceived}</span>
              </div>
              {lastPacketTime && (
                <div className="flex items-center justify-between text-slate-400">
                  <span>Last Stream Tick:</span>
                  <span className="font-mono text-slate-200">{lastPacketTime}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              {status === 'connected' ? (
                <button
                  onClick={disconnectWebSocket}
                  className="w-full py-1.5 text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 rounded-lg transition-colors cursor-pointer"
                >
                  Disconnect Stream (Switch to Local Engine)
                </button>
              ) : (
                <button
                  onClick={connectWebSocket}
                  className="w-full py-1.5 text-xs font-medium text-cyan-200 bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-800/60 rounded-lg transition-colors cursor-pointer"
                >
                  Connect to Django Backend
                </button>
              )}
            </div>

            <p className="text-[10px] text-slate-500 leading-tight">
              When connected, full multi-agent pathfinding, V2V preemption, signal optimization, and metrics are computed on the Python Django server and rendered at 60 FPS in Three.js.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
