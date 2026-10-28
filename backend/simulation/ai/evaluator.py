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
Policy Evaluator for benchmarking Trained AI Policies against Fallback Baselines.
Executes reproducible, identical-seed simulation runs and compares safety, throughput,
emergency corridor clearance, comfort, and latency.
"""

from __future__ import annotations

import time
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

from ..city_map import CityLayout
from ..rule_engine import EMERGENCY_TYPES
from .actions import VehicleAction
from .fallback import FallbackPolicy
from .observations import ObservationBuilder
from .policy import VehiclePolicy
from .safety_shield import SafetyShield


class PolicyEvaluator:
    """Evaluates and compares AI policy vs deterministic rule baseline."""

    def __init__(self) -> None:
        self.obs_builder = ObservationBuilder()
        self.fallback = FallbackPolicy()
        self.shield = SafetyShield()

    def evaluate_scenario(
        self,
        scenario_id: str,
        policy: Optional[VehiclePolicy] = None,
        mode: str = "ai",
        steps: int = 200,
        dt: float = 0.05,
        seed: int = 42,
    ) -> dict:
        """
        Executes a single seeded evaluation run under the specified controller mode ('ai' or 'fallback').
        """
        from ..engine import SimulationEngine

        np.random.seed(seed)
        city = CityLayout()
        engine = SimulationEngine(city)
        engine.load_scenario(scenario_id)

        shield = SafetyShield()

        total_collisions = 0
        total_near_collisions = 0
        total_stops = 0
        speed_samples: List[float] = []
        ttc_samples: List[float] = []
        inference_times_ms: List[float] = []

        for step in range(steps):
            active_vehicles = list(engine.vehicles)
            if not active_vehicles:
                break

            t_infer_start = time.perf_counter()

            if mode == "ai" and policy is not None:
                # 1. Batched AI Policy Inference
                obs_batch = self.obs_builder.build_batch(active_vehicles, engine)
                raw_actions = policy.get_actions(obs_batch, deterministic=True)
                action_dict = {
                    v.id: shield.verify_and_correct(v, raw_actions[i], engine)
                    for i, v in enumerate(active_vehicles)
                }
            else:
                # 2. Deterministic Fallback Controller
                action_dict = {
                    v.id: self.fallback.compute_action(v, engine)
                    for v in active_vehicles
                }

            t_infer_end = time.perf_counter()
            inference_times_ms.append((t_infer_end - t_infer_start) * 1000.0)

            # Apply actions
            for v in active_vehicles:
                act = action_dict.get(v.id)
                if act:
                    v.acceleration = act.accel
                    new_speed = max(0.0, min(v.max_speed, v.speed + act.accel * dt))
                    v.target_speed = new_speed
                    if act.lane_intent == 1:
                        v.target_lateral_offset = 2.4
                        v.is_yielding_to_emergency = True
                    elif act.lane_intent == -1:
                        v.target_lateral_offset = -1.2
                    else:
                        v.target_lateral_offset = 0.0
                        v.is_yielding_to_emergency = False

            # Advance physics
            engine.tick(dt)

            # Collect metrics
            for v in active_vehicles:
                speed_samples.append(v.speed * 3.6)
                if v.speed < 0.2:
                    total_stops += 1

                lead_dist = getattr(v, "_current_lead_dist", 999.0)
                if lead_dist < 2.5:
                    total_collisions += 1
                elif lead_dist < 4.5:
                    total_near_collisions += 1

                ttc = getattr(v, "ttc", None)
                if ttc is not None:
                    ttc_samples.append(ttc)

        m = engine.metrics
        avg_speed = float(np.mean(speed_samples)) if speed_samples else 0.0
        median_speed = float(np.median(speed_samples)) if speed_samples else 0.0
        avg_infer = float(np.mean(inference_times_ms)) if inference_times_ms else 0.0

        return {
            "mode": mode,
            "scenario": scenario_id,
            "sim_time": round(engine.sim_time, 2),
            "total_collisions": total_collisions,
            "near_collisions": total_near_collisions,
            "avg_speed_kmh": round(avg_speed, 2),
            "median_speed_kmh": round(median_speed, 2),
            "throughput_per_min": m.get("throughput_per_min", 0),
            "preemption_success_rate": m.get("emergency_metrics", {}).get("preemption_success_rate", 0),
            "civilian_yield_count": m.get("emergency_metrics", {}).get("civilian_yield_count", 0),
            "safety_interventions": shield.get_metrics(),
            "mean_inference_latency_ms": round(avg_infer, 3),
        }

    def compare_ai_vs_baseline(
        self,
        scenario_id: str,
        policy: VehiclePolicy,
        steps: int = 180,
        seed: int = 42,
    ) -> dict:
        """
        Runs identical-seed comparison between AI Policy and Baseline Rule Controller.
        """
        ai_res = self.evaluate_scenario(scenario_id, policy=policy, mode="ai", steps=steps, seed=seed)
        base_res = self.evaluate_scenario(scenario_id, policy=None, mode="fallback", steps=steps, seed=seed)

        # Compute percentage improvements
        speed_delta = (
            round(((ai_res["avg_speed_kmh"] - base_res["avg_speed_kmh"]) / max(1.0, base_res["avg_speed_kmh"])) * 100, 1)
        )
        coll_delta = ai_res["total_collisions"] - base_res["total_collisions"]
        throughput_delta = (
            round(((ai_res["throughput_per_min"] - base_res["throughput_per_min"]) / max(1.0, base_res["throughput_per_min"])) * 100, 1)
        )

        return {
            "scenario": scenario_id,
            "seed": seed,
            "ai_results": ai_res,
            "baseline_results": base_res,
            "comparison": {
                "speed_improvement_pct": speed_delta,
                "collision_difference": coll_delta,
                "throughput_improvement_pct": throughput_delta,
                "ai_interventions_count": ai_res["safety_interventions"]["total_interventions"],
            },
        }
