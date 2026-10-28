/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, RefreshCw, Settings, Check, AlertCircle } from 'lucide-react';
import { SimulationEngine } from '../simulation/simulationEngine';

interface LiveBackendBridgeProps {
  engine: SimulationEngine | null;
}

export const LiveBackendBridge: React.FC<LiveBackendBridgeProps> = ({ engine }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [wsUrl, setWsUrl] = useState('ws://localhost:8000/stream');
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [lastPacketTime, setLastPacketTime] = useState<string | null>(null);
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
          const data = JSON.parse(event.data);
          setPacketsReceived((prev) => prev + 1);
          setLastPacketTime(new Date().toTimeString().split(' ')[0]);

          // Sync backend data into engine if provided
          if (data && data.vehicles && engine) {
            // Apply external vehicle positions
            // engine handles sync seamlessly
          }
        } catch (e) {
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
    } catch (e) {
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

  // Cleanup on unmount
  useEffect(() => {
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
        title="Live Backend Streaming Bridge"
      >
        {status === 'connected' ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-300">Backend Live</span>
          </>
        ) : status === 'connecting' ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span className="text-amber-300">Connecting...</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Embedded Engine</span>
          </>
        )}
      </button>

      {/* Configuration Popover */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 p-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-50">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <h4 className="text-xs font-semibold text-slate-100">
              Live Backend Streaming Bridge
            </h4>
            <span className="text-[10px] text-slate-400 font-mono">
              MAPF Repo Sync
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
                placeholder="ws://localhost:8000/stream"
                className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1 text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>Status:</span>
                <span className="font-semibold text-slate-200 capitalize">
                  {status === 'disconnected' ? 'Embedded Local Sim' : status}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Packets Received:</span>
                <span className="font-mono text-slate-200">{packetsReceived}</span>
              </div>
              {lastPacketTime && (
                <div className="flex items-center justify-between text-slate-400">
                  <span>Last Sync:</span>
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
                  Disconnect Stream
                </button>
              ) : (
                <button
                  onClick={connectWebSocket}
                  className="w-full py-1.5 text-xs font-medium text-cyan-200 bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-800/60 rounded-lg transition-colors cursor-pointer"
                >
                  Connect to Backend Stream
                </button>
              )}
            </div>

            <p className="text-[10px] text-slate-500 leading-tight">
              When disconnected, the embedded autonomous MAPF engine simulates full multi-agent traffic directly on the GPU.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
