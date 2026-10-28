# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Simulation Scenarios — Python port of scenarios.ts.

Defines all 8 built-in AMAPP traffic-simulation scenarios as plain Python
dicts.  Initial incidents are stored as lightweight dicts (no dataclass
imports required) so this module has zero intra-package dependencies.

Usage::

    from backend.simulation.scenarios import get_scenario, list_scenarios

    cfg = get_scenario('rush_hour')
    all_cfgs = list_scenarios()
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Scenario catalogue
# ---------------------------------------------------------------------------

#: Full catalogue of built-in simulation scenarios.
#:
#: Each entry is a ``dict`` with the following keys:
#:
#: - ``id`` (str): Unique scenario identifier.
#: - ``name`` (str): Human-readable display name.
#: - ``description`` (str): One-sentence scenario summary.
#: - ``vehicle_count`` (int): Target number of spawned vehicles.
#: - ``spawn_rates`` (dict[str, float]): Per-type fractional spawn weights
#:   (must sum to ≤ 1.0).
#: - ``initial_incidents`` (list[dict]): Zero or more pre-placed road
#:   incidents.  Each incident dict contains ``type``, ``x``, ``z``,
#:   ``radius``, and ``label``.
#: - ``emergency_priority_multiplier`` (float): Scales emergency-vehicle
#:   priority throughout the scenario.
SCENARIOS: dict = {
    # ------------------------------------------------------------------
    "police_pursuit": {
        "id": "police_pursuit",
        "name": "Police Intercept & Medical Convoy",
        "description": (
            "High-speed multi-unit pursuit and ambulance escort with 360° V2V "
            "emergency preemption and green-wave signals."
        ),
        "vehicle_count": 52,
        "spawn_rates": {
            "police": 0.20,
            "ambulance": 0.12,
            "sedan": 0.38,
            "suv": 0.15,
            "taxi": 0.10,
            "truck": 0.05,
            "emergency": 0.0,
            "fire_engine": 0.0,
            "vip_limo": 0.0,
        },
        "initial_incidents": [],
        "emergency_priority_multiplier": 4.0,
    },

    # ------------------------------------------------------------------
    "fire_rescue": {
        "id": "fire_rescue",
        "name": "Fire Rescue & Hazmat Quarantine",
        "description": (
            "Heavy fire brigade and hazmat response with avenue-wide exclusion "
            "perimeter and proactive detours."
        ),
        "vehicle_count": 48,
        "spawn_rates": {
            "fire_engine": 0.22,
            "ambulance": 0.10,
            "police": 0.08,
            "sedan": 0.35,
            "suv": 0.15,
            "taxi": 0.07,
            "truck": 0.03,
            "emergency": 0.0,
            "vip_limo": 0.0,
        },
        "initial_incidents": [
            {
                "type": "hazard",
                "x": -37.5,
                "z": -37.5,
                "radius": 22,
                "label": "Commercial Structural Fire & Hazmat",
            },
        ],
        "emergency_priority_multiplier": 3.8,
    },

    # ------------------------------------------------------------------
    "vip_motorcade": {
        "id": "vip_motorcade",
        "name": "VIP Motorcade Tactical Escort",
        "description": (
            "Presidential armored limousine with front & rear tactical SUV escorts "
            "enforcing strict clearance corridors."
        ),
        "vehicle_count": 42,
        "spawn_rates": {
            "vip_limo": 0.08,
            "police": 0.18,
            "suv": 0.24,
            "sedan": 0.35,
            "taxi": 0.10,
            "truck": 0.05,
            "ambulance": 0.0,
            "fire_engine": 0.0,
            "emergency": 0.0,
        },
        "initial_incidents": [],
        "emergency_priority_multiplier": 5.0,
    },

    # ------------------------------------------------------------------
    "rush_hour": {
        "id": "rush_hour",
        "name": "Morning Rush Hour",
        "description": (
            "High-density multi-lane commuter surge with active intersection "
            "coordination and crosswalk yielding."
        ),
        "vehicle_count": 65,
        "spawn_rates": {
            "sedan": 0.45,
            "suv": 0.22,
            "taxi": 0.15,
            "truck": 0.08,
            "police": 0.05,
            "ambulance": 0.03,
            "emergency": 0.02,
            "fire_engine": 0.0,
            "vip_limo": 0.0,
        },
        "initial_incidents": [],
        "emergency_priority_multiplier": 1.5,
    },

    # ------------------------------------------------------------------
    "bottleneck": {
        "id": "bottleneck",
        "name": "Avenue Bottleneck",
        "description": (
            "Central artery construction reducing lane capacity, testing dynamic "
            "zipper merging and reroute diversion."
        ),
        "vehicle_count": 50,
        "spawn_rates": {
            "sedan": 0.45,
            "suv": 0.22,
            "taxi": 0.15,
            "truck": 0.10,
            "police": 0.05,
            "ambulance": 0.03,
            "emergency": 0.0,
            "fire_engine": 0.0,
            "vip_limo": 0.0,
        },
        "initial_incidents": [
            {
                "type": "construction",
                "x": 0,
                "z": 37.5,
                "radius": 14,
                "label": "Water Main Utility Construction",
            },
        ],
        "emergency_priority_multiplier": 1.8,
    },

    # ------------------------------------------------------------------
    "emergency_corridor": {
        "id": "emergency_corridor",
        "name": "Emergency Response Corridor",
        "description": (
            "Emergency responders dispatched across the metropolitan grid with "
            "V2V preemption and civilian yielding."
        ),
        "vehicle_count": 46,
        "spawn_rates": {
            "police": 0.15,
            "ambulance": 0.15,
            "fire_engine": 0.10,
            "sedan": 0.35,
            "suv": 0.15,
            "taxi": 0.05,
            "truck": 0.05,
            "emergency": 0.0,
            "vip_limo": 0.0,
        },
        "initial_incidents": [],
        "emergency_priority_multiplier": 3.5,
    },

    # ------------------------------------------------------------------
    "gridlock": {
        "id": "gridlock",
        "name": "High-Density Gridlock",
        "description": (
            "Maximum capacity test (80+ vehicles) challenging MAPF anti-deadlock "
            "resolution and turn reservations."
        ),
        "vehicle_count": 80,
        "spawn_rates": {
            "sedan": 0.45,
            "suv": 0.22,
            "taxi": 0.15,
            "truck": 0.10,
            "police": 0.04,
            "ambulance": 0.02,
            "emergency": 0.02,
            "fire_engine": 0.0,
            "vip_limo": 0.0,
        },
        "initial_incidents": [],
        "emergency_priority_multiplier": 1.2,
    },

    # ------------------------------------------------------------------
    "incident_recovery": {
        "id": "incident_recovery",
        "name": "Multi-Incident Recovery",
        "description": (
            "Multiple active roadblocks and stalled vehicles requiring distributed "
            "V2V hazard notices and perimeter detours."
        ),
        "vehicle_count": 52,
        "spawn_rates": {
            "police": 0.10,
            "fire_engine": 0.08,
            "sedan": 0.42,
            "suv": 0.20,
            "taxi": 0.12,
            "truck": 0.08,
            "ambulance": 0.0,
            "emergency": 0.0,
            "vip_limo": 0.0,
        },
        "initial_incidents": [
            {
                "type": "accident",
                "x": -75,
                "z": 0,
                "radius": 12,
                "label": "Multi-Car Collision",
            },
            {
                "type": "roadblock",
                "x": 75,
                "z": 75,
                "radius": 12,
                "label": "Emergency Police Roadblock",
            },
        ],
        "emergency_priority_multiplier": 2.0,
    },
}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def get_scenario(scenario_id: str) -> dict:
    """Return the scenario configuration for the given identifier.

    Args:
        scenario_id: One of the eight built-in scenario keys
            (e.g. ``'rush_hour'``, ``'police_pursuit'``).

    Returns:
        The scenario config dict.

    Raises:
        KeyError: If *scenario_id* is not a recognised scenario.
    """
    return SCENARIOS[scenario_id]


def list_scenarios() -> list[dict]:
    """Return all scenario configurations as an ordered list.

    The order matches the insertion order of :data:`SCENARIOS`.

    Returns:
        A list of scenario config dicts.
    """
    return list(SCENARIOS.values())
