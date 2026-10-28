/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Code2,
  Terminal,
  CheckCircle2,
  AlertCircle,
  FileCode,
} from 'lucide-react';
import { LuaEngine, LUA_PRESETS } from '../simulation/luaEngine';

interface LuaScriptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  luaEngine: LuaEngine;
}

export const LuaScriptDrawer: React.FC<LuaScriptDrawerProps> = ({ isOpen, onClose, luaEngine }) => {
  const [code, setCode] = useState(luaEngine.getScript());
  const [isRunning, setIsRunning] = useState(luaEngine.getIsRunning());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'logs'>('editor');

  if (!isOpen) return null;

  const handleApplyScript = () => {
    const result = luaEngine.setScript(code);
    if (result.success) {
      setStatusMessage('Script hot-reloaded and active on all agents.');
      setIsError(false);
    } else {
      setStatusMessage(`Compilation Failed: ${result.error}`);
      setIsError(true);
    }
  };

  const handleToggleRunning = () => {
    const nextState = !isRunning;
    luaEngine.setRunning(nextState);
    setIsRunning(nextState);
  };

  const handleSelectPreset = (key: string) => {
    const preset = LUA_PRESETS[key];
    if (preset) {
      setCode(preset.code);
      const res = luaEngine.setScript(preset.code);
      setStatusMessage(`Loaded preset: ${preset.name}`);
      setIsError(!res.success);
    }
  };

  const logs = luaEngine.getLogs();

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col animate-slideLeft">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <Code2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Traffic Behavior Lua Engine
            </h3>
            <p className="text-[11px] text-slate-400">
              In-browser Lua runtime with live vehicle hook APIs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleRunning}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
              isRunning
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-amber-500/15 border-amber-500/50 text-amber-300'
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isRunning ? 'Active' : 'Paused'}</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Preset Selector Bar */}
      <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between gap-2 overflow-x-auto">
        <span className="text-xs text-slate-400 shrink-0">Presets:</span>
        <div className="flex items-center gap-1.5">
          {Object.entries(LUA_PRESETS).map(([k, p]) => (
            <button
              key={k}
              onClick={() => handleSelectPreset(k)}
              className="px-2.5 py-1 text-[11px] font-medium text-slate-300 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/70 rounded-md whitespace-nowrap transition-colors cursor-pointer"
            >
              {p.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center px-5 pt-2 border-b border-slate-800 bg-slate-950/20">
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'editor'
              ? 'border-emerald-400 text-emerald-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>Script Source</span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'logs'
              ? 'border-emerald-400 text-emerald-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Execution Monitor ({logs.length})</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col p-4 bg-slate-950/80">
        {activeTab === 'editor' ? (
          <div className="flex-1 flex flex-col h-full space-y-3">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="flex-1 w-full p-3 font-mono text-xs bg-slate-900 border border-slate-800 text-slate-200 rounded-xl resize-none focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30 leading-relaxed selection:bg-emerald-900"
              spellCheck={false}
            />

            {statusMessage && (
              <div
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs border ${
                  isError
                    ? 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                    : 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                }`}
              >
                {isError ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>{statusMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500 font-mono">
                API: vehicle:set_target_speed(kmh), vehicle:broadcast_v2v(msg)
              </span>

              <button
                onClick={handleApplyScript}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-lg transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Hot Reload Script</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="text-xs text-slate-400 font-mono">Agent Output Console</span>
              <button
                onClick={() => luaEngine.clearLogs()}
                className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Clear Console
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 p-2 bg-slate-900 border border-slate-800 rounded-xl font-mono text-[11px]">
              {logs.length === 0 ? (
                <div className="text-slate-500 text-center py-8">
                  Console buffer empty. Invoke print(...) inside on_vehicle_tick to inspect agent states.
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex items-start gap-2 py-0.5">
                    <span className="text-slate-600 shrink-0">{log.timestamp}</span>
                    <span
                      className={`break-all ${
                        log.level === 'error'
                          ? 'text-rose-400 font-semibold'
                          : log.level === 'warn'
                          ? 'text-amber-400'
                          : log.level === 'success'
                          ? 'text-emerald-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
