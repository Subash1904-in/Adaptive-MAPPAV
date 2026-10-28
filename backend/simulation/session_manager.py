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

"""Global session manager holding active SimulationEngine instances."""

from __future__ import annotations

from typing import Dict
from .city_map import CityLayout
from .engine import SimulationEngine

_active_engines: Dict[str, SimulationEngine] = {}


def get_or_create_engine(session_id: str = "default") -> SimulationEngine:
    """Returns the existing SimulationEngine for session_id or instantiates a new one."""
    if session_id not in _active_engines:
        city = CityLayout()
        _active_engines[session_id] = SimulationEngine(city)
    return _active_engines[session_id]


def get_engine(session_id: str = "default") -> SimulationEngine | None:
    """Returns the SimulationEngine for session_id if active, else None."""
    return _active_engines.get(session_id)


def remove_engine(session_id: str) -> None:
    """Removes a session engine instance."""
    _active_engines.pop(session_id, None)

