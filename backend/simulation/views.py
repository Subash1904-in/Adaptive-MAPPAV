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

"""HTTP REST API views for AMAPP simulation."""

from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .city_map import CityLayout
from .scenarios import SCENARIOS
from .session_manager import get_engine, get_or_create_engine


@api_view(["GET"])
def get_city(request):
    """Returns static graph topology (nodes, roads, bounds)."""
    city = CityLayout()
    return Response({
        "nodes": [node.to_dict() for node in city.nodes.values()],
        "roads": [road.to_dict() for road in city.roads.values()],
        "bounds": city.bounds,
    })


@api_view(["GET"])
def list_scenarios(request):
    """Returns all 8 built-in scenarios with spawn configuration."""
    return Response(list(SCENARIOS.values()))


@api_view(["POST"])
def create_session(request, session_id):
    """Explicitly initializes a new simulation session."""
    engine = get_or_create_engine(session_id)
    return Response(
        {"status": "ready", "session_id": session_id, "scenario": engine.current_scenario},
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
def load_scenario(request, session_id):
    """Switches scenario for the specified session."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    scenario_id = request.data.get("scenario_id")
    try:
        engine.load_scenario(scenario_id)
    except (KeyError, TypeError, ValueError) as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"status": "ok", "scenario": scenario_id})


@api_view(["POST"])
def add_incident(request, session_id):
    """Places a new dynamic incident in the active simulation."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    required = ("type", "x", "z", "radius", "label")
    if any(field not in request.data for field in required):
        return Response({"error": "type, x, z, radius, and label are required"}, status=400)
    try:
        incident_id = engine.add_incident(
            request.data["type"],
            request.data["x"],
            request.data["z"],
            request.data["radius"],
            request.data["label"],
        )
    except (TypeError, ValueError) as exc:
        return Response({"error": str(exc)}, status=400)
    return Response({"incident_id": incident_id}, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
def remove_incident(request, session_id, incident_id):
    """Removes an active incident by ID."""
    engine = get_engine(session_id)
    if engine is None:
        return Response({"error": "Session not found"}, status=404)
    if not engine.remove_incident(incident_id):
        return Response({"error": "Incident not found"}, status=404)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def set_rule(request, session_id):
    """Changes active rule preset (adaptive_platoon, emergency_corridor, incident_avoidance)."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    preset = request.data.get("preset")
    if not engine.rule_engine.set_preset(preset):
        return Response({"error": f"Unknown rule preset: {preset}"}, status=400)
    return Response({"status": "ok", "preset": preset})


@api_view(["GET"])
def export_logs(request, session_id):
    """Exports structured simulation telemetry logs."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    return Response(engine.export_logs())


@api_view(["GET", "POST"])
def benchmark(request, session_id):
    """Runs a performance benchmark evaluation on the active session."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    duration = float(request.query_params.get("duration", request.data.get("duration", 8.0) if request.data else 8.0))
    result = engine.benchmark(duration_seconds=duration)
    return Response(result)


@api_view(["GET"])
def rl_metrics(request, session_id):
    """Returns RL Q-learning statistics and queue rewards."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    return Response(engine.rl_agent.get_metrics())


@api_view(["POST"])
def set_controller_mode(request, session_id):
    """Sets vehicle controller mode: 'ai', 'fallback', or 'evaluation'."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    mode = request.data.get("mode")
    if not engine.set_controller_mode(mode):
        return Response(
            {"error": f"Failed to set mode '{mode}'. Check if a valid model checkpoint is available."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response({
        "status": "ok",
        "mode": engine.controller_mode,
        "reason": engine.controller_status_reason,
    })


@api_view(["GET"])
def ai_status(request, session_id):
    """Returns AI policy metadata, safety interventions, and available checkpoints."""
    engine = get_engine(session_id) or get_or_create_engine(session_id)
    return Response({
        "controller_mode": engine.controller_mode,
        "status_reason": engine.controller_status_reason,
        "active_model": engine.active_model_meta,
        "safety_shield": engine.safety_shield.get_metrics(),
        "available_checkpoints": engine.policy_registry.list_checkpoints(),
    })
