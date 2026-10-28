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
Benchmarking engine for AMAPP.
Runs comparative performance evaluations across scenarios, tracking throughput,
latency, reroute frequency, and collision risk index.
"""

from __future__ import annotations

import statistics
import time
from typing import TYPE_CHECKING, Dict, List

if TYPE_CHECKING:
    from .engine import SimulationEngine


class BenchmarkRunner:
    """
    Executes benchmark evaluations against a simulation engine instance,
    capturing time-series telemetry and calculating aggregate performance metrics.
    """

    def __init__(self, engine: SimulationEngine) -> None:
        self.engine = engine
        self.history: list[dict] = []

    def run_benchmark(
        self,
        scenario_id: str = "police_pursuit",
        duration_seconds: float = 15.0,
        time_step: float = 0.05,
    ) -> dict:
        """
        Runs a headless simulation benchmark loop for the specified scenario.
        Returns aggregate statistics and evaluation criteria.
        """
        self.engine.load_scenario(scenario_id)
        start_wall_time = time.time()
        sim_elapsed = 0.0
        samples: list[dict] = []

        total_steps = int(duration_seconds / time_step)
        for _ in range(total_steps):
            self.engine.tick(time_step)
            sim_elapsed += time_step

            # Capture snapshot
            metrics = self.engine.metrics
            samples.append({
                "sim_time": round(self.engine.sim_time, 2),
                "active_vehicles": len(self.engine.vehicles),
                "throughput_per_min": metrics.get("throughput_per_min", 0.0),
                "avg_speed_kmh": metrics.get("avg_speed_kmh", 0.0),
                "avg_delay_seconds": metrics.get("avg_delay_seconds", 0.0),
                "collision_risk_index": metrics.get("collision_risk_index", 0.0),
                "total_reroutes": metrics.get("total_reroutes", 0),
            })

        wall_duration = time.time() - start_wall_time
        sim_rate_multiplier = (
            round(duration_seconds / wall_duration, 2) if wall_duration > 0 else 1.0
        )

        # Aggregate statistics
        throughputs = [s["throughput_per_min"] for s in samples if s["throughput_per_min"] > 0]
        speeds = [s["avg_speed_kmh"] for s in samples]
        delays = [s["avg_delay_seconds"] for s in samples]
        risks = [s["collision_risk_index"] for s in samples]

        summary = {
            "scenario": scenario_id,
            "sim_duration_seconds": round(duration_seconds, 2),
            "wall_duration_seconds": round(wall_duration, 3),
            "sim_speedup_factor": f"{sim_rate_multiplier}x",
            "samples_collected": len(samples),
            "performance": {
                "mean_throughput_per_min": round(statistics.mean(throughputs), 1) if throughputs else 0.0,
                "peak_throughput_per_min": round(max(throughputs), 1) if throughputs else 0.0,
                "mean_speed_kmh": round(statistics.mean(speeds), 1) if speeds else 0.0,
                "mean_delay_seconds": round(statistics.mean(delays), 2) if delays else 0.0,
                "peak_collision_risk": round(max(risks), 3) if risks else 0.0,
                "total_reroutes": self.engine.metrics.get("total_reroutes", 0),
                "completed_trips": self.engine.metrics.get("completed_trips", 0),
            },
            "emergency_performance": self.engine.metrics.get("emergency_metrics", {}),
            "evaluated_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        }

        self.history.append(summary)
        return summary

