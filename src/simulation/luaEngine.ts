/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VehicleAgent } from '../types/simulation';

export interface LuaScriptLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface LuaEnvironment {
  logs: LuaScriptLog[];
  maxLogs: number;
  print: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export const LUA_PRESETS: Record<string, { name: string; description: string; code: string }> = {
  adaptive_platoon: {
    name: 'Adaptive Platoon & Distance Control',
    description: 'Calculates dynamic following gap based on velocity and syncs braking via V2V mesh.',
    code: `-- Adaptive Platoon & V2V Spacing Control
-- Invoked per vehicle tick to regulate dynamic velocities and safety spacing

function on_vehicle_tick(vehicle, neighbors, incident_nearby)
    if incident_nearby then
        vehicle:set_avoidance_distance(16.0)
        vehicle:broadcast_v2v("HAZARD_REROUTE")
        vehicle:set_target_speed(18.0)
        return
    end

    local min_dist = 999.0
    local leader_speed = 45.0

    for i = 1, #neighbors do
        local n = neighbors[i]
        if n.distance < min_dist then
            min_dist = n.distance
            leader_speed = n.speed
        end
    end

    if min_dist < 8.0 then
        -- Close following: match leader velocity with smooth deceleration
        vehicle:set_target_speed(math.max(8.0, leader_speed * 0.75))
        vehicle:set_status("braking")
    elseif min_dist < 20.0 then
        -- Coordinated platoon cruising
        vehicle:set_target_speed(leader_speed)
        vehicle:broadcast_v2v("PLATOON_SYNC")
    else
        -- Free-flow speed
        vehicle:set_target_speed(45.0)
        vehicle:set_avoidance_distance(7.0)
    end
end
`,
  },

  emergency_corridor: {
    name: 'Emergency Corridor Preemption',
    description: 'Forces all civilian traffic to yield and decelerate when emergency responders approach.',
    code: `-- Emergency Corridor Preemption
-- Detects approaching emergency vehicles and creates an open lane corridor

function on_vehicle_tick(vehicle, neighbors, incident_nearby)
    if vehicle:is_emergency() then
        vehicle:set_priority(10)
        vehicle:set_target_speed(65.0)
        vehicle:set_avoidance_distance(12.0)
        vehicle:broadcast_v2v("EMERGENCY_CLEAR_PATH")
        return
    end

    -- Check if an emergency vehicle is within V2V communication range
    local emergency_near = false
    for i = 1, #neighbors do
        local n = neighbors[i]
        if n.type == "emergency" and n.distance < 45.0 then
            emergency_near = true
            break
        end
    end

    if emergency_near then
        -- Yield right-of-way: slow down and increase avoidance margin
        vehicle:set_target_speed(12.0)
        vehicle:set_status("yielding")
        vehicle:set_avoidance_distance(15.0)
    else
        vehicle:set_target_speed(42.0)
        vehicle:set_avoidance_distance(6.5)
    end
end
`,
  },

  incident_avoidance: {
    name: 'Dynamic Incident Avoidance & Reroute Surge',
    description: 'Increases sensor lookahead on obstacle detection and boosts local rerouting priority.',
    code: `-- Dynamic Incident Avoidance & Reroute Surge
-- Triggers proactive detour calculations and wide obstacle clearance

function on_vehicle_tick(vehicle, neighbors, incident_nearby)
    if incident_nearby then
        vehicle:set_avoidance_distance(22.0)
        vehicle:set_priority(8)
        vehicle:broadcast_v2v("INCIDENT_OBSTACLE")
        vehicle:set_target_speed(15.0)
        vehicle:set_status("rerouting")
    else
        vehicle:set_avoidance_distance(7.0)
        vehicle:set_priority(3)
        vehicle:set_target_speed(40.0)
    end
end
`,
  },
};

/**
 * Embedded Lua runtime and runner for vehicle traffic modification.
 * Interprets custom Lua scripts and binds them to vehicle state objects.
 */
export class LuaEngine {
  private script: string;
  private logs: LuaScriptLog[] = [];
  private maxLogs = 100;
  private isRunning = true;
  private lastExecError: string | null = null;
  private compiledFn: Function | null = null;

  constructor(initialScript: string = LUA_PRESETS.adaptive_platoon.code) {
    this.script = initialScript;
    this.compile();
  }

  public setScript(script: string): { success: boolean; error?: string } {
    this.script = script;
    return this.compile();
  }

  public getScript(): string {
    return this.script;
  }

  public setRunning(running: boolean) {
    this.isRunning = running;
    this.addLog('info', running ? 'Lua engine activated.' : 'Lua engine paused.');
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getLogs(): LuaScriptLog[] {
    return this.logs;
  }

  public clearLogs() {
    this.logs = [];
  }

  public getLastError(): string | null {
    return this.lastExecError;
  }

  private addLog(level: LuaScriptLog['level'], message: string) {
    const time = new Date().toTimeString().split(' ')[0];
    this.logs.unshift({ timestamp: time, level, message });
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
  }

  /**
   * Compiles Lua script into an executable JS function with Lua semantics
   */
  private compile(): { success: boolean; error?: string } {
    try {
      this.lastExecError = null;
      const transpiledJs = this.transpileLuaToJs(this.script);

      // Create sandboxed runner
      const runner = new Function(
        'vehicle',
        'neighbors',
        'incident_nearby',
        'print',
        'math',
        transpiledJs
      );

      this.compiledFn = runner;
      this.addLog('success', 'Lua script compiled successfully.');
      return { success: true };
    } catch (err: any) {
      this.compiledFn = null;
      this.lastExecError = err.message || String(err);
      this.addLog('error', `Compilation error: ${this.lastExecError}`);
      return { success: false, error: this.lastExecError || undefined };
    }
  }

  /**
   * Transpiles standard Lua control structures, operators, and method calls to JS
   */
  private transpileLuaToJs(luaCode: string): string {
    let js = luaCode;

    // Remove single line comments
    js = js.replace(/--.*$/gm, '');

    // Translate Lua method calls: obj:method(args) -> obj.method(args)
    js = js.replace(/([a-zA-Z0-9_]+):([a-zA-Z0-9_]+)\(/g, '$1.$2(');

    // Translate Lua length operator #array -> array.length
    js = js.replace(/#([a-zA-Z0-9_]+)/g, '$1.length');

    // Translate Lua conditionals:
    // elseif -> } else if (
    js = js.replace(/elseif\s+(.*?)\s+then/g, '} else if ($1) {');
    // if ... then -> if (...) {
    js = js.replace(/if\s+(.*?)\s+then/g, 'if ($1) {');
    // else -> } else {
    js = js.replace(/\belse\b/g, '} else {');
    // end -> }
    js = js.replace(/\bend\b/g, '}');

    // Translate for loop: for i = 1, #array do -> for (let i = 1; i <= array.length; i++) {
    js = js.replace(/for\s+([a-zA-Z0-9_]+)\s*=\s*(.*?),\s*(.*?)\s+do/g, 'for (let $1 = $2; $1 <= $3; $1++) {');

    // Translate local x = y -> let x = y
    js = js.replace(/\blocal\s+/g, 'let ');

    // Translate operators: ~= -> !==, not -> !, and -> &&, or -> ||
    js = js.replace(/~=/g, '!==');
    js = js.replace(/\bnot\b/g, '!');
    js = js.replace(/\band\b/g, '&&');
    js = js.replace(/\bor\b/g, '||');

    // Translate function declaration: function on_vehicle_tick(...) -> function on_vehicle_tick(...) {
    js = js.replace(/function\s+on_vehicle_tick\s*\((.*?)\)/g, 'function on_vehicle_tick($1) {');

    // Auto-invoke on_vehicle_tick if defined
    js += `
      if (typeof on_vehicle_tick === 'function') {
        on_vehicle_tick(vehicle, neighbors, incident_nearby);
      }
    `;

    return js;
  }

  /**
   * Executes the script on a vehicle agent with exposed API hooks
   */
  public executeVehicleTick(
    vehicle: VehicleAgent,
    neighborVehicles: Array<{ id: string; type: string; distance: number; speed: number }>,
    incidentNearby: boolean,
    onBroadcast?: (msg: string) => void
  ) {
    if (!this.isRunning || !this.compiledFn) return;

    // Create safe Lua Vehicle proxy wrapper
    const luaVehicle = {
      id: vehicle.id,
      type: vehicle.type,
      is_emergency: () =>
        vehicle.type === 'emergency' ||
        vehicle.type === 'police' ||
        vehicle.type === 'ambulance' ||
        vehicle.type === 'fire_engine',
      get_speed: () => Math.round(vehicle.speed * 3.6), // km/h
      set_target_speed: (speedKmh: number) => {
        vehicle.targetSpeed = Math.max(0, Math.min(25, Number(speedKmh) / 3.6));
      },
      get_priority: () => vehicle.priority,
      set_priority: (p: number) => {
        vehicle.priority = Math.max(1, Math.min(10, Math.round(p)));
      },
      set_avoidance_distance: (d: number) => {
        vehicle.avoidanceRadius = Math.max(3.0, Math.min(30.0, Number(d)));
      },
      set_status: (status: any) => {
        if (['cruising', 'braking', 'rerouting', 'yielding', 'stopped'].includes(status)) {
          vehicle.status = status;
        }
      },
      shift_lateral: (offsetMeters: number) => {
        vehicle.targetLateralOffset = Math.max(-3.5, Math.min(3.5, Number(offsetMeters)));
      },
      get_lateral_offset: () => vehicle.lateralOffset || 0,
      broadcast_v2v: (message: string) => {
        if (onBroadcast) onBroadcast(message);
      },
    };

    const luaNeighbors = neighborVehicles.map((n) => ({
      id: n.id,
      type: n.type,
      distance: Number(n.distance.toFixed(1)),
      speed: Math.round(n.speed * 3.6),
    }));

    // Lua 1-based indexing proxy for neighbor array
    const neighborsProxy = new Proxy(luaNeighbors, {
      get(target, prop) {
        if (typeof prop === 'string') {
          const idx = parseInt(prop, 10);
          if (!isNaN(idx) && idx >= 1) {
            return target[idx - 1];
          }
        }
        return (target as any)[prop];
      },
    });

    const printHook = (...args: any[]) => {
      this.addLog('info', `[${vehicle.id}]: ${args.join(' ')}`);
    };

    try {
      this.compiledFn(luaVehicle, neighborsProxy, incidentNearby, printHook, Math);
    } catch (err: any) {
      if (!this.lastExecError) {
        this.lastExecError = err.message || String(err);
        this.addLog('warn', `Runtime warning on ${vehicle.id}: ${this.lastExecError}`);
      }
    }
  }
}
