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
Dedicated simulation worker for long-running headless simulation and benchmark runs.
Can be executed as a standalone CLI worker or as a background service:
    python -m simulation.worker --scenario fire_rescue --duration 60 --persist
"""

from __future__ import annotations

import argparse
import os
import sys
import time

# Ensure Django environment is configured if executed standalone
if not os.environ.get("DJANGO_SETTINGS_MODULE"):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
    import django
    django.setup()

from django.utils import timezone
from simulation.city_map import CityLayout
from simulation.engine import SimulationEngine
from simulation.models import BenchmarkResult, MetricsSnapshot, SimulationRun


class SimulationWorker:
    """
    Orchestrates long-running batch simulations, logging periodic snapshots
    to the database and computing aggregate benchmark performance upon completion.
    """

    def __init__(
        self,
        scenario_id: str = "police_pursuit",
        step_dt: float = 0.033,
        snapshot_interval_seconds: float = 2.0,
    ) -> None:
        self.scenario_id = scenario_id
        self.step_dt = step_dt
        self.snapshot_interval = snapshot_interval_seconds
        self.city = CityLayout()
        self.engine = SimulationEngine(self.city)
        self.engine.load_scenario(scenario_id)

    def run(self, duration_seconds: float = 30.0, persist_to_db: bool = True) -> dict:
        """
        Executes headless simulation loop for the specified duration.
        Optionally persists run history and metrics snapshots to Django ORM.
        """
        run_record = None
        if persist_to_db:
            run_record = SimulationRun.objects.create(
                scenario=self.scenario_id,
                total_vehicles=len(self.engine.vehicles),
            )

        print(
            f"[AMAPP Worker] Starting long-running simulation: {self.scenario_id} "
            f"for {duration_seconds}s (dt={self.step_dt}s)..."
        )

        start_time = time.time()
        last_snapshot_time = start_time
        steps = 0

        while (time.time() - start_time) < duration_seconds:
            self.engine.tick(self.step_dt)
            steps += 1

            now = time.time()
            if (now - last_snapshot_time) >= self.snapshot_interval:
                last_snapshot_time = now
                m = self.engine.metrics
                print(
                    f"  [T+{round(now - start_time, 1)}s] SimTime: {round(self.engine.sim_time, 1)}s | "
                    f"Active: {m['active_vehicles']} | "
                    f"AvgSpeed: {m['avg_speed_kmh']} km/h | "
                    f"Throughput: {m['throughput_per_min']}/min | "
                    f"PreemptionRate: {m['emergency_metrics']['preemption_success_rate']}%"
                )

                if persist_to_db and run_record:
                    MetricsSnapshot.objects.create(
                        run=run_record,
                        sim_time=self.engine.sim_time,
                        active_vehicles=m["active_vehicles"],
                        throughput_per_min=m["throughput_per_min"],
                    )

        # Run completion summary
        final_summary = self.engine.benchmark_runner.run_benchmark(
            scenario_id=self.scenario_id,
            duration_seconds=min(10.0, duration_seconds),
        )

        if persist_to_db and run_record:
            run_record.ended_at = timezone.now()
            run_record.completed_trips = self.engine.completed_trips
            run_record.save()

            BenchmarkResult.objects.create(
                run=run_record,
                scenario=self.scenario_id,
                avg_throughput=final_summary["performance"]["mean_throughput_per_min"],
                avg_delay=final_summary["performance"]["mean_delay_seconds"],
            )

        print(f"[AMAPP Worker] Finished {steps} ticks in {round(time.time() - start_time, 2)}s wall clock.")
        return final_summary


def main():
    parser = argparse.ArgumentParser(description="AMAPP Long-Running Simulation Worker")
    parser.add_argument("--scenario", type=str, default="police_pursuit", help="Scenario ID to execute")
    parser.add_argument("--duration", type=float, default=20.0, help="Run duration in seconds")
    parser.add_argument("--dt", type=float, default=0.033, help="Physics delta-time step (default 0.033)")
    parser.add_argument("--persist", action="store_true", help="Persist metrics to Django DB")
    args = parser.parse_args()

    worker = SimulationWorker(scenario_id=args.scenario, step_dt=args.dt)
    summary = worker.run(duration_seconds=args.duration, persist_to_db=args.persist)
    print("[AMAPP Worker] Final Result Summary:")
    print(summary)


if __name__ == "__main__":
    main()

