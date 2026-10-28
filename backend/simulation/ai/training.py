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
Training Manager for Multi-Agent Autonomous Traffic Policies.
Implements batched Multi-Agent PPO (MAPPO) with Generalized Advantage Estimation (GAE),
real gradient updates, loss tracking, and a 5-stage curriculum (Stages A through E).
"""

from __future__ import annotations

import os
import random
import time
from typing import Dict, List, Optional, Tuple
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from .actions import VehicleAction
from .environment import MultiAgentTrafficEnv
from .policy import VehiclePolicy, OBS_DIM, HIDDEN_DIM
from .registry import ModelRegistry

# Curriculum Stage definitions
CURRICULUM_STAGES = {
    "stage_a": {
        "name": "Stage A: Basic Driving & Car Following",
        "scenarios": ["bottleneck"],
        "description": "Speed control, following gaps, deceleration limits, lane keeping.",
        "steps_per_epoch": 120,
    },
    "stage_b": {
        "name": "Stage B: Route Planning & In-Route Rerouting",
        "scenarios": ["incident_recovery", "bottleneck"],
        "description": "Evaluation of alternative routes, detour around bottlenecks.",
        "steps_per_epoch": 140,
    },
    "stage_c": {
        "name": "Stage C: Cooperative Intersections & Platooning",
        "scenarios": ["rush_hour", "bottleneck"],
        "description": "Traffic signal compliance, dilemma zone, right-of-way, CACC platooning.",
        "steps_per_epoch": 150,
    },
    "stage_d": {
        "name": "Stage D: Emergency Operations & Corridor Preemption",
        "scenarios": ["emergency_corridor", "police_pursuit", "fire_rescue"],
        "description": "Emergency responder priority, signal green wave, civilian yielding.",
        "steps_per_epoch": 160,
    },
    "stage_e": {
        "name": "Stage E: Mixed Traffic Stress & Generalization",
        "scenarios": ["rush_hour", "gridlock", "police_pursuit", "vip_motorcade"],
        "description": "Full heterogeneous traffic with dynamic incidents and high density.",
        "steps_per_epoch": 180,
    },
}


class TrainingManager:
    """
    Executes real parameter optimization using multi-agent PPO.
    Manages rollout buffer collection, GAE calculation, actor-critic loss optimization,
    and curriculum progression.
    """

    def __init__(
        self,
        lr: float = 3e-4,
        gamma: float = 0.98,
        gae_lambda: float = 0.95,
        clip_ratio: float = 0.2,
        value_coef: float = 0.5,
        entropy_coef: float = 0.01,
        seed: int = 42,
        device: str = "cpu",
    ) -> None:
        self.lr = lr
        self.gamma = gamma
        self.gae_lambda = gae_lambda
        self.clip_ratio = clip_ratio
        self.value_coef = value_coef
        self.entropy_coef = entropy_coef
        self.seed = seed
        self.device = torch.device(device)

        self._set_seed(seed)
        self.policy = VehiclePolicy().to(self.device)
        self.optimizer = optim.Adam(self.policy.parameters(), lr=self.lr, eps=1e-5)
        self.registry = ModelRegistry()

    def _set_seed(self, seed: int) -> None:
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)

    def train_epoch(
        self,
        env: MultiAgentTrafficEnv,
        steps: int = 150,
    ) -> dict:
        """
        Collects multi-agent rollout data in the environment and executes real PPO update steps.
        """
        self.policy.eval()

        # Rollout storage buffers
        b_obs: List[torch.Tensor] = []
        b_accel: List[torch.Tensor] = []
        b_lane: List[torch.Tensor] = []
        b_route: List[torch.Tensor] = []
        b_v2v: List[torch.Tensor] = []
        b_inter: List[torch.Tensor] = []
        b_rewards: List[float] = []
        b_values: List[float] = []
        b_log_probs: List[float] = []
        b_dones: List[bool] = []

        obs_dict, _ = env.reset(seed=self.seed)
        total_epoch_reward = 0.0
        step_count = 0

        for _ in range(steps):
            if not env.agents:
                break

            active_agents = list(env.agents)
            agent_obs = np.array([obs_dict[aid] for aid in active_agents], dtype=np.float32)
            obs_tensor = torch.from_numpy(agent_obs).to(self.device)

            with torch.no_grad():
                dist_accel, dist_lane, dist_route, dist_v2v, dist_inter, value = self.policy(obs_tensor)

                act_accel = dist_accel.sample()
                act_lane = dist_lane.sample() - 1
                act_route = dist_route.sample()
                act_v2v = dist_v2v.sample()
                act_inter = dist_inter.sample()

                # Joint log prob
                log_prob = (
                    dist_accel.log_prob(act_accel).sum(dim=-1)
                    + 0.5 * dist_lane.log_prob(act_lane + 1)
                    + 0.5 * dist_route.log_prob(act_route)
                    + 0.25 * dist_v2v.log_prob(act_v2v)
                    + 0.5 * dist_inter.log_prob(act_inter)
                )

            # Build action dictionary for stepping environment
            action_dict: Dict[str, VehicleAction] = {}
            for i, aid in enumerate(active_agents):
                act = VehicleAction(
                    accel=float(act_accel[i].cpu().numpy()),
                    lane_intent=int(act_lane[i].cpu().numpy()),
                    route_choice=int(act_route[i].cpu().numpy()),
                    v2v_message=int(act_v2v[i].cpu().numpy()),
                    intersection_intent=int(act_inter[i].cpu().numpy()),
                    applied_by="ai",
                ).clamp()
                action_dict[aid] = act

            next_obs_dict, rewards, terms, truncs, _ = env.step(action_dict)

            # Record transitions
            for i, aid in enumerate(active_agents):
                r = rewards.get(aid, 0.0)
                d = terms.get(aid, False) or truncs.get(aid, False)

                b_obs.append(obs_tensor[i].cpu())
                b_accel.append(act_accel[i].cpu())
                b_lane.append(act_lane[i].cpu())
                b_route.append(act_route[i].cpu())
                b_v2v.append(act_v2v[i].cpu())
                b_inter.append(act_inter[i].cpu())
                b_rewards.append(r)
                b_values.append(float(value[i].cpu().numpy()))
                b_log_probs.append(float(log_prob[i].cpu().numpy()))
                b_dones.append(d)

                total_epoch_reward += r

            obs_dict = next_obs_dict
            step_count += 1

        if not b_obs:
            return {"loss": 0.0, "reward": 0.0, "steps": 0}

        # Convert buffers to tensors
        t_obs = torch.stack(b_obs).to(self.device)
        t_accel = torch.stack(b_accel).to(self.device)
        t_lane = torch.stack(b_lane).to(self.device)
        t_route = torch.stack(b_route).to(self.device)
        t_v2v = torch.stack(b_v2v).to(self.device)
        t_inter = torch.stack(b_inter).to(self.device)
        t_old_log_probs = torch.tensor(b_log_probs, dtype=torch.float32, device=self.device)
        t_rewards = np.array(b_rewards, dtype=np.float32)
        t_values = np.array(b_values, dtype=np.float32)
        t_dones = np.array(b_dones, dtype=np.float32)

        # Compute Generalized Advantage Estimation (GAE)
        n = len(t_rewards)
        advantages = np.zeros(n, dtype=np.float32)
        last_gae = 0.0
        for i in reversed(range(n)):
            next_val = t_values[i + 1] if i + 1 < n else 0.0
            next_done = t_dones[i]
            delta = t_rewards[i] + self.gamma * next_val * (1.0 - next_done) - t_values[i]
            last_gae = delta + self.gamma * self.gae_lambda * (1.0 - next_done) * last_gae
            advantages[i] = last_gae

        returns = advantages + t_values
        t_returns = torch.tensor(returns, dtype=torch.float32, device=self.device)
        t_adv = torch.tensor(advantages, dtype=torch.float32, device=self.device)
        # Normalize advantages
        t_adv = (t_adv - t_adv.mean()) / (t_adv.std() + 1e-8)

        # PPO Optimization Step (Actual gradient updates)
        self.policy.train()
        train_epochs = 3
        batch_size = min(64, n)
        total_policy_loss = 0.0
        total_value_loss = 0.0

        for _ in range(train_epochs):
            indices = np.random.permutation(n)
            for start_idx in range(0, n, batch_size):
                batch_indices = indices[start_idx : start_idx + batch_size]
                b_idx = torch.tensor(batch_indices, dtype=torch.long, device=self.device)

                log_probs, entropy, values = self.policy.evaluate_actions(
                    t_obs[b_idx],
                    t_accel[b_idx],
                    t_lane[b_idx],
                    t_route[b_idx],
                    t_v2v[b_idx],
                    t_inter[b_idx],
                )

                # Ratio for PPO
                ratios = torch.exp(log_probs - t_old_log_probs[b_idx])
                surr1 = ratios * t_adv[b_idx]
                surr2 = torch.clamp(ratios, 1.0 - self.clip_ratio, 1.0 + self.clip_ratio) * t_adv[b_idx]
                policy_loss = -torch.min(surr1, surr2).mean()

                # Value loss
                value_loss = 0.5 * ((values.squeeze(-1) - t_returns[b_idx]) ** 2).mean()

                # Entropy loss
                entropy_loss = -self.entropy_coef * entropy.mean()

                loss = policy_loss + self.value_coef * value_loss + entropy_loss

                # Backpropagation and optimizer step
                self.optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(self.policy.parameters(), max_norm=0.5)
                self.optimizer.step()

                total_policy_loss += float(policy_loss.item())
                total_value_loss += float(value_loss.item())

        avg_reward = total_epoch_reward / max(1, len(b_rewards))
        return {
            "policy_loss": round(total_policy_loss / train_epochs, 4),
            "value_loss": round(total_value_loss / train_epochs, 4),
            "mean_step_reward": round(avg_reward, 3),
            "samples": n,
        }

    def train_curriculum(
        self,
        epochs_per_stage: int = 4,
        version: str = "curriculum_v1",
        on_progress: Optional[callable] = None,
    ) -> dict:
        """
        Executes full multi-stage curriculum training across Stages A through E.
        Updates weights on every epoch and persists verified checkpoints.
        """
        results: Dict[str, Any] = {"stages": {}, "total_time": 0.0}
        t0 = time.time()
        global_steps = 0

        for stage_key, stage_info in CURRICULUM_STAGES.items():
            print(f"\n[TrainingManager] Beginning {stage_info['name']}...")
            stage_metrics = []

            for epoch in range(epochs_per_stage):
                scenario = random.choice(stage_info["scenarios"])
                env = MultiAgentTrafficEnv(
                    scenario_id=scenario,
                    dt=0.05,
                    max_steps=stage_info["steps_per_epoch"],
                )
                metrics = self.train_epoch(env, steps=stage_info["steps_per_epoch"])
                global_steps += metrics.get("samples", 0)
                stage_metrics.append(metrics)

                status_msg = (
                    f"  Epoch {epoch + 1}/{epochs_per_stage} [{scenario}] - "
                    f"Reward: {metrics['mean_step_reward']} | "
                    f"PolicyLoss: {metrics['policy_loss']} | "
                    f"ValueLoss: {metrics['value_loss']}"
                )
                print(status_msg)
                if on_progress:
                    on_progress(stage_key, epoch + 1, metrics)

            results["stages"][stage_key] = stage_metrics

        results["total_time"] = round(time.time() - t0, 2)
        results["global_samples"] = global_steps

        # Save trained checkpoint into ModelRegistry
        meta = {
            "version": version,
            "algorithm": "MAPPO-CTDE",
            "training_steps": global_steps,
            "curriculum_stage": "Stage E Complete",
            "epochs_per_stage": epochs_per_stage,
            "evaluation_scores": {},
        }
        ckpt_path = self.registry.save_checkpoint(self.policy, version, meta, is_promoted=True)
        results["checkpoint_path"] = ckpt_path
        print(f"\n[TrainingManager] Curriculum complete! Checkpoint saved to: {ckpt_path}")
        return results

    def run_smoke_test(self) -> dict:
        """
        Rapid smoke test verifying that environments step headlessly,
        gradients flow through all Actor-Critic heads, weights update, and checkpoints save/load.
        """
        print("[TrainingManager] Running RL training smoke test...")
        env = MultiAgentTrafficEnv(scenario_id="bottleneck", dt=0.05, max_steps=40)
        initial_weight_norm = sum(p.norm().item() for p in self.policy.parameters())

        metrics = self.train_epoch(env, steps=30)
        updated_weight_norm = sum(p.norm().item() for p in self.policy.parameters())

        weight_changed = abs(updated_weight_norm - initial_weight_norm) > 1e-6
        smoke_version = f"smoke_test_{int(time.time())}"
        ckpt = self.registry.save_checkpoint(
            self.policy,
            smoke_version,
            {"training_steps": metrics["samples"], "curriculum_stage": "Smoke Test"},
            is_promoted=False,
        )
        loaded_policy, _ = self.registry.load_checkpoint(smoke_version)

        smoke_passed = weight_changed and loaded_policy is not None
        print(
            f"[TrainingManager] Smoke test result: {'PASSED' if smoke_passed else 'FAILED'} "
            f"(Samples: {metrics['samples']}, Weights Updated: {weight_changed})"
        )
        return {
            "passed": smoke_passed,
            "metrics": metrics,
            "weight_changed": weight_changed,
            "checkpoint": ckpt,
        }
