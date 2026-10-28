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
Celery background tasks for asynchronous, long-running simulation workloads.
Enables scheduled benchmark matrix runs, policy training, and stress testing.
"""

from __future__ import annotations

try:
    from celery import shared_task
except ImportError:
    # Fallback decorator if Celery is not installed in the environment
    def shared_task(func):
        func.delay = lambda *args, **kwargs: func(*args, **kwargs)
        return func

from .worker import SimulationWorker


@shared_task
def run_long_simulation_task(scenario_id: str = "police_pursuit", duration_seconds: float = 30.0) -> dict:
    """Asynchronous task for long-running simulation execution with DB persistence."""
    worker = SimulationWorker(scenario_id=scenario_id)
    return worker.run(duration_seconds=duration_seconds, persist_to_db=True)


@shared_task
def run_scenario_benchmark_matrix() -> dict:
    """Evaluates all 8 scenarios sequentially in the background and aggregates results."""
    from .scenarios import SCENARIOS

    results = {}
    for scenario_id in SCENARIOS:
        worker = SimulationWorker(scenario_id=scenario_id)
        results[scenario_id] = worker.run(duration_seconds=10.0, persist_to_db=True)
    return results

