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
Django management command for training, smoke-testing, and evaluating
the AMAPP Multi-Agent Reinforcement Learning traffic policies.
"""

from __future__ import annotations

import json
from django.core.management.base import BaseCommand

from simulation.ai.evaluator import PolicyEvaluator
from simulation.ai.registry import ModelRegistry
from simulation.ai.training import TrainingManager
from simulation.scenarios import SCENARIOS


class Command(BaseCommand):
    help = "Train, evaluate, and benchmark Multi-Agent Reinforcement Learning (MARL) traffic policies."

    def add_arguments(self, parser):
        parser.add_argument(
            "--smoke-test",
            action="store_true",
            help="Run a quick verification smoke test checking gradients and checkpoint loading.",
        )
        parser.add_argument(
            "--curriculum",
            action="store_true",
            help="Run the complete 5-stage training curriculum (Stages A through E).",
        )
        parser.add_argument(
            "--epochs-per-stage",
            type=int,
            default=3,
            help="Number of training epochs per curriculum stage (default: 3).",
        )
        parser.add_argument(
            "--model-version",
            type=str,
            default="curriculum_v1",
            help="Model checkpoint version string.",
        )
        parser.add_argument(
            "--evaluate",
            action="store_true",
            help="Evaluate the active AI policy against the baseline rule controller.",
        )
        parser.add_argument(
            "--benchmark-all",
            action="store_true",
            help="Evaluate all 8 scenarios across identical seeds comparing AI vs Baseline.",
        )
        parser.add_argument(
            "--scenario",
            type=str,
            default="police_pursuit",
            help="Scenario ID for single-scenario evaluation (default: police_pursuit).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=42,
            help="Random seed for reproducibility (default: 42).",
        )

    def handle(self, *args, **options):
        trainer = TrainingManager(seed=options["seed"])
        evaluator = PolicyEvaluator()
        registry = ModelRegistry()

        if options["smoke_test"]:
            self.stdout.write(self.style.NOTICE("Executing MARL training smoke test..."))
            res = trainer.run_smoke_test()
            if res["passed"]:
                self.stdout.write(self.style.SUCCESS(f"Smoke test PASSED! Checkpoint: {res['checkpoint']}"))
            else:
                self.stdout.write(self.style.ERROR("Smoke test FAILED."))
            return

        if options["curriculum"]:
            self.stdout.write(
                self.style.NOTICE(
                    f"Beginning 5-Stage MARL Curriculum Training ({options['epochs_per_stage']} epochs/stage)..."
                )
            )
            res = trainer.train_curriculum(
                epochs_per_stage=options["epochs_per_stage"],
                version=options["model_version"],
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Curriculum training completed in {res['total_time']}s! "
                    f"Saved to: {res['checkpoint_path']}"
                )
            )
            return

        if options["evaluate"]:
            policy, meta = registry.load_latest_promoted()
            if policy is None:
                self.stdout.write(
                    self.style.WARNING("No promoted policy found. Training a fresh baseline policy first...")
                )
                trainer.run_smoke_test()
                policy, meta = registry.load_latest_promoted()

            scenario = options["scenario"]
            self.stdout.write(
                self.style.NOTICE(
                    f"Comparing AI Policy vs Baseline on '{scenario}' (Seed: {options['seed']})..."
                )
            )
            res = evaluator.compare_ai_vs_baseline(
                scenario, policy=policy, steps=180, seed=options["seed"]
            )
            self.stdout.write(json.dumps(res, indent=2))
            comp = res["comparison"]
            self.stdout.write(
                self.style.SUCCESS(
                    f"Comparison Result: Speed Delta: {comp['speed_improvement_pct']}% | "
                    f"Collision Delta: {comp['collision_difference']} | "
                    f"Throughput Delta: {comp['throughput_improvement_pct']}%"
                )
            )
            return

        if options["benchmark_all"]:
            policy, meta = registry.load_latest_promoted()
            if policy is None:
                self.stdout.write(self.style.ERROR("No model checkpoint available to benchmark."))
                return

            self.stdout.write(
                self.style.NOTICE(
                    f"Running full benchmark matrix across all {len(SCENARIOS)} scenarios..."
                )
            )
            all_results = {}
            for sc in SCENARIOS:
                comp = evaluator.compare_ai_vs_baseline(sc, policy=policy, steps=120, seed=options["seed"])
                all_results[sc] = comp["comparison"]
                self.stdout.write(
                    f"  Scenario '{sc}': Speed Delta {comp['comparison']['speed_improvement_pct']}%, "
                    f"Collisions: {comp['comparison']['collision_difference']}"
                )
            self.stdout.write(self.style.SUCCESS("All scenario benchmarks completed."))
            return

        # Default help
        self.stdout.write("Use --smoke-test, --curriculum, --evaluate, or --benchmark-all.")
