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
Traffic Signal Manager — Python port of trafficSignals.ts (state-machine only).

Handles the strict 52.0-second 6-phase signal cycle, emergency preemption,
and per-intersection light state for the AMAPP Django backend.  All Three.js
mesh / rendering code has been intentionally omitted.
"""

from __future__ import annotations

import math
from typing import Any

# ---------------------------------------------------------------------------
# Cycle timing constants (exact values from trafficSignals.ts)
# ---------------------------------------------------------------------------
STRICT_CYCLE_DURATION: float = 52.0  # Total urban cycle duration (s)
PHASE_NS_GREEN: float = 20.0          # North-South green phase duration (s)
PHASE_NS_YELLOW: float = 4.0          # North-South yellow caution duration (s)
PHASE_NS_ALL_RED: float = 2.0         # All-red clearance after NS (s)
PHASE_EW_GREEN: float = 20.0          # East-West green phase duration (s)
PHASE_EW_YELLOW: float = 4.0          # East-West yellow caution duration (s)
PHASE_EW_ALL_RED: float = 2.0         # All-red clearance after EW (s)
HALF_CYCLE: float = 26.0              # 20 + 4 + 2 — midpoint of the cycle (s)


class TrafficSignalManager:
    """Manages all intersection traffic-light state machines in the city grid.

    Ports the TypeScript ``TrafficSignalManager`` class, keeping only the
    signal-timing and emergency-preemption logic.  3-D mesh operations are not
    included.

    The manager operates on the ``city.nodes`` mapping that is expected to
    contain node objects with an optional ``traffic_light`` attribute
    (a mutable dict or object with the fields listed below).

    Expected ``traffic_light`` field schema::

        {
            'ns_state': str,               # 'green' | 'yellow' | 'red'
            'ew_state': str,
            'timer': float,
            'cycle_duration': float,
            'phase_index': int,
            'phase_name': str,
            'phase_time_remaining': float,
            'emergency_override_axis': str | None,   # 'ns' | 'ew' | None
            'emergency_override_timer': float,
        }
    """

    def __init__(self, city: Any) -> None:
        """Initialise with a reference to the city layout.

        Args:
            city: A ``CityLayout``-like object whose ``.nodes`` attribute is a
                  dict/mapping of ``node_id -> node``.  Each node that should
                  be signal-controlled must expose a ``traffic_light`` dict.
        """
        self.city = city
        self.total_preemptions: int = 0

        # Seed each intersection with a deterministic initial phase so that
        # adjacent nodes start offset by HALF_CYCLE (green-wave coordination).
        self._initialize_signals()

    # ------------------------------------------------------------------
    # Initialisation
    # ------------------------------------------------------------------

    def _initialize_signals(self) -> None:
        """Seed every traffic-light node with a deterministic initial phase.

        Adjacent grid nodes receive offset timers (0.0 s vs 26.0 s) so that
        a natural green-wave propagates across the network from startup.
        """
        for node_id, node in self.city.nodes.items():
            # Only process nodes that already have a traffic_light placeholder.
            if not hasattr(node, "traffic_light") or node.traffic_light is None:
                continue

            parts = node_id.split("_")
            try:
                gx = int(parts[1]) if len(parts) > 1 else 0
                gz = int(parts[2]) if len(parts) > 2 else 0
            except ValueError:
                gx, gz = 0, 0

            initial_timer = 0.0 if (gx + gz) % 2 == 0 else HALF_CYCLE
            phase = TrafficSignalManager.evaluate_cycle_phase(initial_timer)

            tl = node.traffic_light
            tl["ns_state"] = phase["ns_state"]
            tl["ew_state"] = phase["ew_state"]
            tl["timer"] = initial_timer
            tl["cycle_duration"] = STRICT_CYCLE_DURATION
            tl["phase_index"] = phase["phase_index"]
            tl["phase_name"] = phase["phase_name"]
            tl["phase_time_remaining"] = phase["phase_time_remaining"]
            tl["emergency_override_axis"] = None
            tl["emergency_override_timer"] = 0.0

    # ------------------------------------------------------------------
    # Static cycle evaluator
    # ------------------------------------------------------------------

    @staticmethod
    def evaluate_cycle_phase(timer: float) -> dict:
        """Evaluate the strict 6-phase 52 s signal cycle for a given timer.

        The 6 phases and their time windows::

            Phase 1 — NS Green          [  0.0,  20.0)
            Phase 2 — NS Yellow Caution [ 20.0,  24.0)
            Phase 3 — All-Red (NS→EW)   [ 24.0,  26.0)
            Phase 4 — EW Green          [ 26.0,  46.0)
            Phase 5 — EW Yellow Caution [ 46.0,  50.0)
            Phase 6 — All-Red (EW→NS)   [ 50.0,  52.0)

        Args:
            timer: Raw elapsed time in seconds.  Values outside [0, 52) are
                   wrapped via modulo automatically.

        Returns:
            A dict with keys:
            - ``ns_state`` (str): Signal colour for the north-south axis.
            - ``ew_state`` (str): Signal colour for the east-west axis.
            - ``phase_index`` (int): 1-based phase number (1–6).
            - ``phase_name`` (str): Human-readable phase label.
            - ``phase_time_remaining`` (float): Seconds until this phase ends,
              rounded to one decimal place.
        """
        t = timer % STRICT_CYCLE_DURATION

        if t < PHASE_NS_GREEN:
            return {
                "ns_state": "green",
                "ew_state": "red",
                "phase_index": 1,
                "phase_name": "North-South Green",
                "phase_time_remaining": round(PHASE_NS_GREEN - t, 1),
            }
        elif t < PHASE_NS_GREEN + PHASE_NS_YELLOW:
            return {
                "ns_state": "yellow",
                "ew_state": "red",
                "phase_index": 2,
                "phase_name": "North-South Yellow Caution",
                "phase_time_remaining": round(PHASE_NS_GREEN + PHASE_NS_YELLOW - t, 1),
            }
        elif t < HALF_CYCLE:
            return {
                "ns_state": "red",
                "ew_state": "red",
                "phase_index": 3,
                "phase_name": "All-Red Clearance Hold (NS Transition)",
                "phase_time_remaining": round(HALF_CYCLE - t, 1),
            }
        elif t < HALF_CYCLE + PHASE_EW_GREEN:
            return {
                "ns_state": "red",
                "ew_state": "green",
                "phase_index": 4,
                "phase_name": "East-West Green",
                "phase_time_remaining": round(HALF_CYCLE + PHASE_EW_GREEN - t, 1),
            }
        elif t < HALF_CYCLE + PHASE_EW_GREEN + PHASE_EW_YELLOW:
            return {
                "ns_state": "red",
                "ew_state": "yellow",
                "phase_index": 5,
                "phase_name": "East-West Yellow Caution",
                "phase_time_remaining": round(
                    HALF_CYCLE + PHASE_EW_GREEN + PHASE_EW_YELLOW - t, 1
                ),
            }
        else:
            return {
                "ns_state": "red",
                "ew_state": "red",
                "phase_index": 6,
                "phase_name": "All-Red Clearance Hold (EW Transition)",
                "phase_time_remaining": round(STRICT_CYCLE_DURATION - t, 1),
            }

    # ------------------------------------------------------------------
    # Per-frame update
    # ------------------------------------------------------------------

    def update(self, dt: float) -> None:
        """Advance every intersection light by *dt* seconds.

        For each node that carries a ``traffic_light``:

        - **Emergency override active**: decrement the override timer; hold the
          preempted axis green and the other axis red; clear the override when
          the timer expires.
        - **Normal operation**: advance the cycle timer and re-evaluate the
          current phase via :meth:`evaluate_cycle_phase`.

        Args:
            dt: Frame delta-time in seconds.
        """
        for _node_id, node in self.city.nodes.items():
            tl = getattr(node, "traffic_light", None)
            if tl is None:
                continue

            if tl.get("emergency_override_axis"):
                # A — Emergency Preemption Override
                tl["emergency_override_timer"] -= dt

                if tl["emergency_override_axis"] == "ns":
                    tl["ns_state"] = "green"
                    tl["ew_state"] = "red"
                    tl["phase_name"] = "Emergency V2I Green-Wave Preemption (NS)"
                else:
                    tl["ew_state"] = "green"
                    tl["ns_state"] = "red"
                    tl["phase_name"] = "Emergency V2I Green-Wave Preemption (EW)"

                if tl["emergency_override_timer"] <= 0:
                    tl["emergency_override_axis"] = None

            else:
                # B — Standard 52-second strict 6-phase cycle
                tl["timer"] = (tl["timer"] + dt) % STRICT_CYCLE_DURATION
                phase = TrafficSignalManager.evaluate_cycle_phase(tl["timer"])

                tl["ns_state"] = phase["ns_state"]
                tl["ew_state"] = phase["ew_state"]
                tl["phase_index"] = phase["phase_index"]
                tl["phase_name"] = phase["phase_name"]
                tl["phase_time_remaining"] = phase["phase_time_remaining"]
                tl["cycle_duration"] = STRICT_CYCLE_DURATION

    # ------------------------------------------------------------------
    # Emergency preemption
    # ------------------------------------------------------------------

    def request_emergency_preemption(
        self, node_id: str, axis: str, duration: float = 7.0
    ) -> None:
        """Request a V2I green-wave preemption for an emergency vehicle.

        Anti-thrash guard: if a different-axis preemption is already active
        with more than 2.5 s remaining the new request is silently dropped to
        avoid rapid oscillation between axes.

        Args:
            node_id: Map node identifier for the target intersection.
            axis: ``'ns'`` or ``'ew'`` — the axis that needs a green signal.
            duration: How long (in seconds) the preemption should last.
                      Defaults to 7.0 s.
        """
        node = self.city.nodes.get(node_id)
        if node is None:
            return
        tl = getattr(node, "traffic_light", None)
        if tl is None:
            return

        current_override = tl.get("emergency_override_axis")

        # Anti-thrash: don't steal a different-axis override that still has
        # meaningful time remaining.
        if (
            current_override
            and current_override != axis
            and tl.get("emergency_override_timer", 0) > 2.5
        ):
            return

        if not current_override:
            self.total_preemptions += 1

        tl["emergency_override_axis"] = axis
        tl["emergency_override_timer"] = duration

    # ------------------------------------------------------------------
    # Vehicle signal queries
    # ------------------------------------------------------------------

    def is_signal_red_for_vehicle(self, node_id: str, heading: float) -> bool:
        """Return whether a vehicle is facing a red or yellow signal.

        The travel axis is derived from the heading angle: if
        ``|cos(heading)| > 0.707`` the vehicle travels on the north-south
        axis, otherwise east-west.

        Args:
            node_id: Target intersection node identifier.
            heading: Vehicle heading in radians (standard math convention).

        Returns:
            ``True`` if the relevant signal is red or yellow; ``False``
            if green or if the node has no traffic light.
        """
        node = self.city.nodes.get(node_id)
        if node is None:
            return False
        tl = getattr(node, "traffic_light", None)
        if tl is None:
            return False

        axis = "ns" if abs(math.cos(heading)) > 0.707 else "ew"
        state = tl.get(f"{axis}_state", "red")
        return state in ("red", "yellow")

    # ------------------------------------------------------------------
    # Telemetry helpers
    # ------------------------------------------------------------------

    def get_cycle_info(self, node_id: str) -> dict | None:
        """Return detailed timing telemetry for a single intersection.

        Args:
            node_id: Target intersection node identifier.

        Returns:
            A dict with keys ``nodeId``, ``cycleDuration``, ``timer``,
            ``phaseIndex``, ``phaseName``, ``phaseRemaining``, ``nsState``,
            ``ewState``, and ``emergencyOverride``, or ``None`` if the node
            does not exist or has no traffic light.
        """
        node = self.city.nodes.get(node_id)
        if node is None:
            return None
        tl = getattr(node, "traffic_light", None)
        if tl is None:
            return None

        override_axis = tl.get("emergency_override_axis")
        override_timer = tl.get("emergency_override_timer", 0.0)
        override_str = (
            f"{override_axis.upper()} ({override_timer:.1f}s)"
            if override_axis
            else "None"
        )

        return {
            "nodeId": node_id,
            "cycleDuration": STRICT_CYCLE_DURATION,
            "timer": round(tl.get("timer", 0.0), 1),
            "phaseIndex": tl.get("phase_index", 1),
            "phaseName": tl.get("phase_name", ""),
            "phaseRemaining": tl.get("phase_time_remaining", 0.0),
            "nsState": tl.get("ns_state", "red"),
            "ewState": tl.get("ew_state", "red"),
            "emergencyOverride": override_str,
        }

    def get_all_lights_state(self) -> dict:
        """Return a snapshot of every intersection's signal state.

        Intended for WebSocket broadcast payloads so the frontend can render
        all traffic-light colours without polling individual nodes.

        Returns:
            A dict mapping each ``node_id`` to a sub-dict containing:
            ``ns_state``, ``ew_state``, ``phase_index``, ``phase_name``,
            ``phase_time_remaining``, ``emergency_override_axis``, and
            ``emergency_override_timer``.
        """
        result: dict = {}
        for node_id, node in self.city.nodes.items():
            tl = getattr(node, "traffic_light", None)
            if tl is None:
                continue
            result[node_id] = {
                "ns_state": tl.get("ns_state", "red"),
                "ew_state": tl.get("ew_state", "red"),
                "phase_index": tl.get("phase_index", 1),
                "phase_name": tl.get("phase_name", ""),
                "phase_time_remaining": tl.get("phase_time_remaining", 0.0),
                "emergency_override_axis": tl.get("emergency_override_axis"),
                "emergency_override_timer": tl.get("emergency_override_timer", 0.0),
            }
        return result
