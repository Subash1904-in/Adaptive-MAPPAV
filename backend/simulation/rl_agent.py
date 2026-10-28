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
Reinforcement Learning (RL) agent for adaptive traffic signal and priority optimization.
Implements tabular Q-learning with state discretization for intersection queue minimization.
"""

from __future__ import annotations

import random
from typing import Dict, Tuple


class TrafficSignalRLAgent:
    """
    Q-learning agent for adaptive intersection phase management.
    Controls whether to HOLD the current green phase, ADVANCE to yellow/clearance,
    or trigger an EMERGENCY PRIORITY corridor.
    """

    # Actions: 0 = HOLD_CURRENT, 1 = ADVANCE_PHASE, 2 = EXTEND_PREEMPTION
    ACTIONS = [0, 1, 2]
    ACTION_NAMES = ["HOLD_CURRENT", "ADVANCE_PHASE", "EXTEND_PREEMPTION"]

    def __init__(
        self,
        learning_rate: float = 0.1,
        discount_factor: float = 0.95,
        exploration_rate: float = 0.15,
        exploration_decay: float = 0.999,
        min_exploration: float = 0.02,
    ) -> None:
        self.lr = learning_rate
        self.gamma = discount_factor
        self.epsilon = exploration_rate
        self.epsilon_decay = exploration_decay
        self.min_epsilon = min_exploration

        # Q-table: (ns_density_bucket, ew_density_bucket, phase_bucket, has_emergency) -> [Q(a0), Q(a1), Q(a2)]
        self.q_table: Dict[Tuple[int, int, int, bool], list[float]] = {}
        self.total_steps = 0
        self.cumulative_reward = 0.0
        self.recent_rewards: list[float] = []

    def _discretize_density(self, count: int) -> int:
        if count <= 0:
            return 0
        if count <= 2:
            return 1
        if count <= 5:
            return 2
        if count <= 9:
            return 3
        return 4

    def get_state_key(
        self,
        ns_queue: int,
        ew_queue: int,
        phase_index: int,
        has_emergency: bool,
    ) -> Tuple[int, int, int, bool]:
        ns_bucket = self._discretize_density(ns_queue)
        ew_bucket = self._discretize_density(ew_queue)
        phase_bucket = max(1, min(6, phase_index))
        return (ns_bucket, ew_bucket, phase_bucket, bool(has_emergency))

    def _get_q_values(self, state: Tuple[int, int, int, bool]) -> list[float]:
        if state not in self.q_table:
            # Optimistic initialization for phase transitions, high bias for emergency handling
            self.q_table[state] = [0.0, 0.0, 0.5 if state[3] else 0.0]
        return self.q_table[state]

    def select_action(
        self,
        ns_queue: int,
        ew_queue: int,
        phase_index: int,
        has_emergency: bool,
    ) -> int:
        state = self.get_state_key(ns_queue, ew_queue, phase_index, has_emergency)
        q_vals = self._get_q_values(state)

        # Epsilon-greedy exploration
        if random.random() < self.epsilon:
            # Bias exploration toward preemption if emergency vehicle is present
            if has_emergency and random.random() < 0.7:
                return 2
            return random.choice(self.ACTIONS)

        # Greedy action
        max_q = max(q_vals)
        best_actions = [a for a, q in enumerate(q_vals) if q == max_q]
        return random.choice(best_actions)

    def compute_reward(
        self,
        ns_queue: int,
        ew_queue: int,
        vehicles_passed: int,
        has_emergency: bool,
        emergency_delayed: bool,
        preemption_success: bool,
    ) -> float:
        # Negative penalty for congestion queue length
        penalty_queue = -0.15 * (ns_queue + ew_queue)

        # Positive reward for vehicle throughput
        reward_throughput = 1.2 * vehicles_passed

        # High-magnitude reward/penalty for emergency priority
        reward_emergency = 0.0
        if has_emergency:
            if preemption_success:
                reward_emergency += 5.0
            if emergency_delayed:
                reward_emergency -= 8.0

        total_reward = penalty_queue + reward_throughput + reward_emergency
        return total_reward

    def learn(
        self,
        old_state: Tuple[int, int, int, bool],
        action: int,
        reward: float,
        new_state: Tuple[int, int, int, bool],
    ) -> None:
        q_current = self._get_q_values(old_state)[action]
        q_next_max = max(self._get_q_values(new_state))

        # Bellman update
        new_q = q_current + self.lr * (reward + self.gamma * q_next_max - q_current)
        self.q_table[old_state][action] = new_q

        self.total_steps += 1
        self.cumulative_reward += reward
        self.recent_rewards.append(reward)
        if len(self.recent_rewards) > 200:
            self.recent_rewards.pop(0)

        # Decay exploration rate
        self.epsilon = max(self.min_epsilon, self.epsilon * self.epsilon_decay)

    def get_metrics(self) -> dict:
        avg_reward = (
            sum(self.recent_rewards) / len(self.recent_rewards)
            if self.recent_rewards
            else 0.0
        )
        return {
            "total_steps": self.total_steps,
            "epsilon": round(self.epsilon, 4),
            "q_states_count": len(self.q_table),
            "recent_avg_reward": round(avg_reward, 3),
            "cumulative_reward": round(self.cumulative_reward, 2),
        }

