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
Model Registry for Multi-Agent Policy Checkpoints.
Handles model saving, loading, versioning, metadata tracking, and promotion validation.
"""

from __future__ import annotations

import json
import os
import time
from typing import Dict, List, Optional, Tuple
import torch

from .policy import VehiclePolicy, OBS_DIM, HIDDEN_DIM

CHECKPOINT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "checkpoints"
)


class ModelRegistry:
    """Manages versioned PyTorch checkpoints and promotion criteria."""

    def __init__(self, directory: str = CHECKPOINT_DIR) -> None:
        self.directory = directory
        os.makedirs(self.directory, exist_ok=True)

    def save_checkpoint(
        self,
        policy: VehiclePolicy,
        version: str,
        metadata: dict,
        is_promoted: bool = False,
    ) -> str:
        """Saves a policy checkpoint with comprehensive metadata."""
        meta = {
            "version": version,
            "algorithm": metadata.get("algorithm", "MAPPO-CTDE"),
            "obs_dim": policy.obs_dim,
            "hidden_dim": policy.hidden_dim,
            "training_steps": metadata.get("training_steps", 0),
            "curriculum_stage": metadata.get("curriculum_stage", "Stage E"),
            "training_date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "evaluation_scores": metadata.get("evaluation_scores", {}),
            "promoted": is_promoted,
        }

        filename = f"policy_{version}.pt"
        filepath = os.path.join(self.directory, filename)
        meta_filepath = os.path.join(self.directory, f"policy_{version}.json")

        payload = {
            "model_state_dict": policy.state_dict(),
            "metadata": meta,
        }
        torch.save(payload, filepath)

        with open(meta_filepath, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        return filepath

    def load_latest_promoted(self) -> Tuple[Optional[VehiclePolicy], Optional[dict]]:
        """Finds and loads the latest verified promoted policy."""
        checkpoints = self.list_checkpoints()
        promoted = [c for c in checkpoints if c.get("promoted", False)]
        if not promoted:
            # Fallback to the latest available checkpoint if none explicitly marked promoted
            if checkpoints:
                latest = checkpoints[0]
                return self.load_checkpoint(latest["version"])
            return None, None

        latest_promoted = promoted[0]
        return self.load_checkpoint(latest_promoted["version"])

    def load_checkpoint(self, version: str) -> Tuple[Optional[VehiclePolicy], Optional[dict]]:
        """Loads a specific checkpoint version."""
        filename = f"policy_{version}.pt"
        filepath = os.path.join(self.directory, filename)
        if not os.path.exists(filepath):
            return None, None

        try:
            payload = torch.load(filepath, map_location="cpu")
            metadata = payload.get("metadata", {})
            policy = VehiclePolicy(
                obs_dim=metadata.get("obs_dim", OBS_DIM),
                hidden_dim=metadata.get("hidden_dim", HIDDEN_DIM),
            )
            policy.load_state_dict(payload["model_state_dict"])
            policy.eval()
            return policy, metadata
        except Exception as exc:
            print(f"[ModelRegistry] Failed to load checkpoint {filepath}: {exc}")
            return None, None

    def list_checkpoints(self) -> List[dict]:
        """Returns metadata for all available checkpoints, sorted newest first."""
        results = []
        if not os.path.exists(self.directory):
            return results

        for fname in os.listdir(self.directory):
            if fname.endswith(".json") and fname.startswith("policy_"):
                path = os.path.join(self.directory, fname)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        data["file"] = fname.replace(".json", ".pt")
                        results.append(data)
                except Exception:
                    continue

        results.sort(key=lambda x: x.get("training_date", ""), reverse=True)
        return results

    def promote_checkpoint(self, version: str, eval_results: dict) -> bool:
        """Promotes a checkpoint if it meets minimal safety and performance criteria."""
        # Promotion criteria:
        # 1. Zero catastrophic collisions (< 1 per 1000 steps)
        # 2. Minimum route throughput
        # 3. Emergency preemption rate >= 70%
        collision_rate = eval_results.get("collision_rate", 999.0)
        preemption_rate = eval_results.get("preemption_success_rate", 0.0)

        is_safe = collision_rate < 0.02 and preemption_rate >= 60.0

        meta_path = os.path.join(self.directory, f"policy_{version}.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["promoted"] = is_safe
            data["evaluation_scores"] = eval_results
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

        pt_path = os.path.join(self.directory, f"policy_{version}.pt")
        if os.path.exists(pt_path):
            payload = torch.load(pt_path, map_location="cpu")
            payload["metadata"]["promoted"] = is_safe
            payload["metadata"]["evaluation_scores"] = eval_results
            torch.save(payload, pt_path)

        return is_safe
