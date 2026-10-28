/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Typed client for AMAPP Django REST Framework endpoints.
 */

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8000/api';
const WS_BASE_URL = (import.meta as any).env?.VITE_WS_BASE_URL || 'ws://localhost:8000/ws/sim';

export interface CityData {
  nodes: Array<{
    id: string;
    x: number;
    z: number;
    node_type: string;
    connected_node_ids: string[];
    traffic_light?: any;
  }>;
  roads: Array<{
    id: string;
    from_node_id: string;
    to_node_id: string;
    lanes: number;
    length: number;
    speed_limit: number;
    capacity: number;
  }>;
  bounds: {
    min_x: number;
    max_x: number;
    min_z: number;
    max_z: number;
  };
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  vehicle_count: number;
  spawn_rates: Record<string, number>;
  initial_incidents: Array<any>;
  emergency_priority_multiplier: number;
}

export const api = {
  getWsUrl: (sessionId = 'default'): string => `${WS_BASE_URL}/${sessionId}/`,

  async getCity(): Promise<CityData> {
    const res = await fetch(`${API_BASE_URL}/city/`);
    if (!res.ok) throw new Error(`Failed to fetch city: ${res.statusText}`);
    return res.json();
  },

  async listScenarios(): Promise<ScenarioDefinition[]> {
    const res = await fetch(`${API_BASE_URL}/scenarios/`);
    if (!res.ok) throw new Error(`Failed to list scenarios: ${res.statusText}`);
    return res.json();
  },

  async loadScenario(sessionId: string, scenarioId: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/sim/${sessionId}/scenario/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_id: scenarioId }),
    });
    return res.json();
  },

  async addIncident(
    sessionId: string,
    incident: { type: string; x: number; z: number; radius: number; label: string }
  ): Promise<{ incident_id: string }> {
    const res = await fetch(`${API_BASE_URL}/sim/${sessionId}/incidents/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incident),
    });
    return res.json();
  },

  async removeIncident(sessionId: string, incidentId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE_URL}/sim/${sessionId}/incidents/${incidentId}/`, {
      method: 'DELETE',
    });
    return res.status === 204;
  },

  async setRule(sessionId: string, preset: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/sim/${sessionId}/rule/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset }),
    });
    return res.json();
  },

  async runBenchmark(sessionId: string, duration = 8.0): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/sim/${sessionId}/benchmark/?duration=${duration}`);
    return res.json();
  },

  async getRLMetrics(sessionId: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/sim/${sessionId}/rl/metrics/`);
    return res.json();
  },

  async exportLogs(sessionId: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/sim/${sessionId}/export/`);
    return res.json();
  },
};

