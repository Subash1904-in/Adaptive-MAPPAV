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
Rule Engine — Python replacement for the TypeScript Lua transpiler (luaEngine.ts).

Implements the three built-in rule presets as native Python methods, faithful to
the original Lua semantics.  Speed values are converted between km/h (Lua API
surface) and m/s (internal vehicle units) using the same ``/ 3.6`` factor used
in the original JS proxy.

Preset mapping:

+---------------------+-------------------------------------------+
| Preset key          | Original Lua function                     |
+=====================+===========================================+
| adaptive_platoon    | on_vehicle_tick — platoon spacing / V2V   |
| emergency_corridor  | on_vehicle_tick — emergency yield logic   |
| incident_avoidance  | on_vehicle_tick — wide-clearance reroute  |
+---------------------+-------------------------------------------+

Usage::

    from backend.simulation.rule_engine import RuleEngine

    engine = RuleEngine(preset='adaptive_platoon')
    engine.execute_vehicle_tick(vehicle, neighbors, incident_nearby=False)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Vehicle types that are treated as emergency / high-priority actors.
EMERGENCY_TYPES: frozenset[str] = frozenset(
    {"police", "ambulance", "fire_engine", "emergency", "vip_limo"}
)

#: Metadata for each built-in rule preset.
RULE_PRESETS: dict[str, dict[str, str]] = {
    "adaptive_platoon": {
        "name": "Adaptive Platoon & Distance Control",
        "description": (
            "Calculates dynamic following gap based on velocity and syncs "
            "braking via V2V mesh."
        ),
    },
    "emergency_corridor": {
        "name": "Emergency Corridor Preemption",
        "description": (
            "Forces all civilian traffic to yield when emergency responders approach."
        ),
    },
    "incident_avoidance": {
        "name": "Dynamic Incident Avoidance & Reroute Surge",
        "description": (
            "Increases sensor lookahead on obstacle detection and boosts local "
            "rerouting priority."
        ),
    },
}


# ---------------------------------------------------------------------------
# Rule Engine
# ---------------------------------------------------------------------------

class RuleEngine:
    """Native Python rule engine replacing the Lua transpiler.

    Applies one of three built-in rule presets to each vehicle on every
    simulation tick.  Presets are selected by name and applied in-place to
    the vehicle object via its public attributes.

    Vehicle attribute contract (used by all rules):

    - ``id`` (str): Unique vehicle identifier.
    - ``type`` (str): Vehicle class (``'sedan'``, ``'police'``, etc.).
    - ``target_speed`` (float): Desired speed in **m/s**.
    - ``avoidance_radius`` (float): Obstacle-detection radius in metres.
    - ``priority`` (int): Scheduling priority (1–10).
    - ``status`` (str): One of ``'cruising'``, ``'braking'``, ``'rerouting'``,
      ``'yielding'``, ``'stopped'``.

    ``neighbors`` format (list of dicts):

    .. code-block:: python

        [{'id': str, 'type': str, 'distance': float, 'speed': float}, ...]

    where ``speed`` is in **km/h** (matching the original Lua API surface).
    """

    def __init__(self, preset: str = "adaptive_platoon") -> None:
        """Create a new engine instance.

        Args:
            preset: Initial rule preset key.  Must be one of the keys in
                :data:`RULE_PRESETS`.  Defaults to ``'adaptive_platoon'``.
        """
        self._active_preset: str = preset
        self._logs: list[dict] = []
        self._max_logs: int = 100

    # ------------------------------------------------------------------
    # Preset management
    # ------------------------------------------------------------------

    def set_preset(self, preset_name: str) -> bool:
        """Switch the active rule preset.

        Args:
            preset_name: Target preset key (must exist in :data:`RULE_PRESETS`).

        Returns:
            ``True`` on success; ``False`` if *preset_name* is unknown.
        """
        if preset_name not in RULE_PRESETS:
            return False
        self._active_preset = preset_name
        self._add_log("info", f"Rule preset changed to: {preset_name}")
        return True

    def get_preset(self) -> str:
        """Return the currently active preset key.

        Returns:
            The active preset name string.
        """
        return self._active_preset

    def get_preset_info(self) -> dict:
        """Return metadata for the currently active preset.

        Returns:
            A dict with ``name`` and ``description`` keys copied from
            :data:`RULE_PRESETS`.
        """
        return dict(RULE_PRESETS[self._active_preset])

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------

    def get_logs(self) -> list[dict]:
        """Return the rule engine log buffer (most recent first).

        Returns:
            A list of log entry dicts, each with keys ``level``, ``message``,
            and ``timestamp`` (ISO 8601).
        """
        return list(self._logs)

    def clear_logs(self) -> None:
        """Clear the log buffer."""
        self._logs = []

    def _add_log(self, level: str, message: str) -> None:
        """Prepend a log entry and truncate the buffer to *_max_logs*.

        Args:
            level: Severity string (e.g. ``'info'``, ``'warn'``, ``'error'``).
            message: Log message text.
        """
        entry = {
            "level": level,
            "message": message,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        }
        self._logs.insert(0, entry)
        if len(self._logs) > self._max_logs:
            self._logs = self._logs[: self._max_logs]

    # ------------------------------------------------------------------
    # Tick dispatcher
    # ------------------------------------------------------------------

    def execute_vehicle_tick(
        self,
        vehicle: Any,
        neighbors: list[dict],
        incident_nearby: bool,
    ) -> None:
        """Apply the active rule preset to *vehicle* in-place.

        Dispatches to the appropriate private rule method based on the current
        active preset.  Any exception raised inside a rule is caught, logged as
        a warning, and silently suppressed so that a single faulty vehicle does
        not crash the simulation loop.

        Args:
            vehicle: The vehicle agent object to modify in-place.
            neighbors: List of nearby vehicle descriptors.  Each dict has keys:
                ``id`` (str), ``type`` (str), ``distance`` (float, metres),
                and ``speed`` (float, km/h).
            incident_nearby: ``True`` if a road incident is within the
                vehicle's sensor lookahead range.
        """
        try:
            if self._active_preset == "adaptive_platoon":
                self._adaptive_platoon(vehicle, neighbors, incident_nearby)
            elif self._active_preset == "emergency_corridor":
                self._emergency_corridor(vehicle, neighbors, incident_nearby)
            elif self._active_preset == "incident_avoidance":
                self._incident_avoidance(vehicle, neighbors, incident_nearby)
        except Exception as exc:  # noqa: BLE001
            self._add_log("warn", f"Rule error on {vehicle.id}: {exc}")

    # ------------------------------------------------------------------
    # Rule implementations (private)
    # ------------------------------------------------------------------

    def _adaptive_platoon(
        self,
        vehicle: Any,
        neighbors: list[dict],
        incident_nearby: bool,
    ) -> None:
        """Adaptive Platoon & Distance Control rule.

        Mirrors the Lua ``on_vehicle_tick`` in the ``adaptive_platoon`` preset:

        1. If an incident is nearby, widen avoidance and set a slow hazard speed.
        2. Find the closest neighbour and its speed.
        3. Apply one of three speed/status bands based on gap distance.

        Args:
            vehicle: Vehicle agent to modify.
            neighbors: Nearby vehicle descriptors (``speed`` in km/h).
            incident_nearby: Incident proximity flag.
        """
        if incident_nearby:
            vehicle.avoidance_radius = 16.0
            # broadcast_v2v analogue — logged for traceability
            self._add_log("info", f"[{vehicle.id}] V2V: HAZARD_REROUTE")
            vehicle.target_speed = 18.0 / 3.6
            return

        min_dist: float = 999.0
        leader_speed: float = 45.0  # km/h default (free-flow)

        for n in neighbors:
            if n["distance"] < min_dist:
                min_dist = n["distance"]
                leader_speed = n["speed"]

        if min_dist < 8.0:
            # Close following: match leader with smooth deceleration
            vehicle.target_speed = max(8.0 / 3.6, (leader_speed * 0.75) / 3.6)
            vehicle.status = "braking"
        elif min_dist < 20.0:
            # Coordinated platoon cruising — sync with leader
            vehicle.target_speed = leader_speed / 3.6
            self._add_log("info", f"[{vehicle.id}] V2V: PLATOON_SYNC")
        else:
            # Free-flow: cruise at default speed
            vehicle.target_speed = 45.0 / 3.6
            vehicle.avoidance_radius = 7.0

    def _emergency_corridor(
        self,
        vehicle: Any,
        neighbors: list[dict],
        incident_nearby: bool,  # noqa: ARG002 — not used by this rule
    ) -> None:
        """Emergency Corridor Preemption rule.

        Mirrors the Lua ``on_vehicle_tick`` in the ``emergency_corridor`` preset:

        1. Emergency vehicles claim maximum priority and speed immediately.
        2. Civilian vehicles yield when an emergency type is within 45 m.

        Args:
            vehicle: Vehicle agent to modify.
            neighbors: Nearby vehicle descriptors (``speed`` in km/h).
            incident_nearby: Unused by this rule (kept for uniform signature).
        """
        # Emergency actor: assert right-of-way
        if vehicle.type in EMERGENCY_TYPES:
            vehicle.priority = 10
            vehicle.target_speed = 65.0 / 3.6
            vehicle.avoidance_radius = 12.0
            self._add_log("info", f"[{vehicle.id}] V2V: EMERGENCY_CLEAR_PATH")
            return

        # Check for emergency neighbours within V2V range
        emergency_near = any(
            n["type"] in EMERGENCY_TYPES and n["distance"] < 45.0
            for n in neighbors
        )

        if emergency_near:
            vehicle.target_speed = 12.0 / 3.6
            vehicle.status = "yielding"
            vehicle.avoidance_radius = 15.0
        else:
            vehicle.target_speed = 42.0 / 3.6
            vehicle.avoidance_radius = 6.5

    def _incident_avoidance(
        self,
        vehicle: Any,
        neighbors: list[dict],  # noqa: ARG002 — not used by this rule
        incident_nearby: bool,
    ) -> None:
        """Dynamic Incident Avoidance & Reroute Surge rule.

        Mirrors the Lua ``on_vehicle_tick`` in the ``incident_avoidance`` preset:

        - Incident nearby → wide clearance, elevated priority, slow reroute speed.
        - No incident → normal avoidance radius and speed.

        Args:
            vehicle: Vehicle agent to modify.
            neighbors: Unused by this rule (kept for uniform signature).
            incident_nearby: Incident proximity flag.
        """
        if incident_nearby:
            vehicle.avoidance_radius = 22.0
            vehicle.priority = 8
            self._add_log("info", f"[{vehicle.id}] V2V: INCIDENT_OBSTACLE")
            vehicle.target_speed = 15.0 / 3.6
            vehicle.status = "rerouting"
        else:
            vehicle.avoidance_radius = 7.0
            vehicle.priority = 3
            vehicle.target_speed = 40.0 / 3.6
