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
PyTorch Multi-Agent Actor-Critic Vehicle Policy.
Implements Centralized Training with Decentralized Execution (CTDE) and parameter sharing.
"""

from __future__ import annotations

from typing import Dict, List, Tuple
import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Normal, Categorical

from .actions import VehicleAction

OBS_DIM = 32
HIDDEN_DIM = 128


class VehiclePolicy(nn.Module):
    """
    Decentralized Actor-Critic policy module.
    Takes normalized 32-D vehicle observations and outputs continuous acceleration
    along with discrete tactical decisions (lane, route, V2V, intersection).
    """

    def __init__(self, obs_dim: int = OBS_DIM, hidden_dim: int = HIDDEN_DIM) -> None:
        super().__init__()
        self.obs_dim = obs_dim
        self.hidden_dim = hidden_dim

        # Shared feature trunk
        self.trunk = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
        )

        # 1. Continuous Acceleration Head (mean and log_std)
        self.accel_mean = nn.Linear(hidden_dim, 1)
        self.accel_log_std = nn.Parameter(torch.zeros(1, 1) - 0.5)

        # 2. Discrete Tactical Heads
        self.lane_head = nn.Linear(hidden_dim, 3)          # -1, 0, +1
        self.route_head = nn.Linear(hidden_dim, 3)         # 0, 1, 2
        self.v2v_head = nn.Linear(hidden_dim, 4)           # 0, 1, 2, 3
        self.inter_head = nn.Linear(hidden_dim, 3)         # 0, 1, 2

        # 3. Critic State-Value Head
        self.value_head = nn.Linear(hidden_dim, 1)

        # Custom initialization for stability
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0.0)
        # Small gain on output heads
        nn.init.orthogonal_(self.accel_mean.weight, gain=0.01)
        nn.init.orthogonal_(self.lane_head.weight, gain=0.01)
        nn.init.orthogonal_(self.route_head.weight, gain=0.01)
        nn.init.orthogonal_(self.v2v_head.weight, gain=0.01)
        nn.init.orthogonal_(self.inter_head.weight, gain=0.01)
        nn.init.orthogonal_(self.value_head.weight, gain=1.0)

    def forward(
        self, obs: torch.Tensor
    ) -> Tuple[Normal, Categorical, Categorical, Categorical, Categorical, torch.Tensor]:
        features = self.trunk(obs)

        # Acceleration distribution (clamped mean)
        raw_accel = self.accel_mean(features)
        accel_mean = torch.tanh(raw_accel) * 4.0 - 0.5  # Range [-4.5, +3.5] m/s²
        accel_std = torch.exp(torch.clamp(self.accel_log_std, -2.0, 0.5))
        dist_accel = Normal(accel_mean, accel_std)

        # Discrete distributions
        dist_lane = Categorical(logits=self.lane_head(features))
        dist_route = Categorical(logits=self.route_head(features))
        dist_v2v = Categorical(logits=self.v2v_head(features))
        dist_inter = Categorical(logits=self.inter_head(features))

        # Value estimate
        value = self.value_head(features)

        return dist_accel, dist_lane, dist_route, dist_v2v, dist_inter, value

    def get_actions(
        self, obs_np: np.ndarray, deterministic: bool = False
    ) -> List[VehicleAction]:
        """
        Batched inference for inference loop.
        Takes np.ndarray shape (N, 32) and returns list of VehicleAction objects.
        """
        if obs_np.shape[0] == 0:
            return []

        self.eval()
        with torch.no_grad():
            obs_tensor = torch.from_numpy(obs_np).float()
            dist_accel, dist_lane, dist_route, dist_v2v, dist_inter, _ = self.forward(obs_tensor)

            if deterministic:
                accel = dist_accel.mean.squeeze(-1)
                lane = torch.argmax(dist_lane.logits, dim=-1) - 1
                route = torch.argmax(dist_route.logits, dim=-1)
                v2v = torch.argmax(dist_v2v.logits, dim=-1)
                inter = torch.argmax(dist_inter.logits, dim=-1)
            else:
                accel = dist_accel.sample().squeeze(-1)
                lane = dist_lane.sample() - 1
                route = dist_route.sample()
                v2v = dist_v2v.sample()
                inter = dist_inter.sample()

            accel_vals = accel.cpu().numpy()
            lane_vals = lane.cpu().numpy()
            route_vals = route.cpu().numpy()
            v2v_vals = v2v.cpu().numpy()
            inter_vals = inter.cpu().numpy()

            actions = []
            for i in range(obs_np.shape[0]):
                act = VehicleAction(
                    accel=float(accel_vals[i]),
                    lane_intent=int(lane_vals[i]),
                    route_choice=int(route_vals[i]),
                    v2v_message=int(v2v_vals[i]),
                    intersection_intent=int(inter_vals[i]),
                    applied_by="ai",
                ).clamp()
                actions.append(act)

        return actions

    def evaluate_actions(
        self,
        obs: torch.Tensor,
        accel_actions: torch.Tensor,
        lane_actions: torch.Tensor,
        route_actions: torch.Tensor,
        v2v_actions: torch.Tensor,
        inter_actions: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Used during PPO training to compute joint log-probs, entropy, and state-values.
        """
        dist_accel, dist_lane, dist_route, dist_v2v, dist_inter, value = self.forward(obs)

        # Log probabilities
        accel_log_prob = dist_accel.log_prob(accel_actions).sum(dim=-1)
        lane_log_prob = dist_lane.log_prob(lane_actions + 1)
        route_log_prob = dist_route.log_prob(route_actions)
        v2v_log_prob = dist_v2v.log_prob(v2v_actions)
        inter_log_prob = dist_inter.log_prob(inter_actions)

        total_log_prob = (
            accel_log_prob
            + 0.5 * lane_log_prob
            + 0.5 * route_log_prob
            + 0.25 * v2v_log_prob
            + 0.5 * inter_log_prob
        )

        # Entropies for exploration regularization
        entropy = (
            dist_accel.entropy().sum(dim=-1)
            + dist_lane.entropy()
            + dist_route.entropy()
            + dist_v2v.entropy()
            + dist_inter.entropy()
        )

        return total_log_prob, entropy, value
