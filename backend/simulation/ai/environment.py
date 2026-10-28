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
Gymnasium / PettingZoo ParallelEnv compliant Multi-Agent Traffic Environment.
Wraps SimulationEngine for headless CTDE policy training and benchmarking.
"""

from __future__ import annotations

import random
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

try:
    from pettingzoo import ParallelEnv
    HAS_PETTINGZOO = True
except ImportError:
    ParallelEnv = object
    HAS_PETTINGZOO = False

import gymnasium
from gymnasium import spaces

from ..city_map import CityLayout
from ..scenarios import SCENARIOS
from .actions import VehicleAction
from .observations import ObservationBuilder, OBSERVATION_DIM
from .rewards import RewardCalculator
from .safety_shield import SafetyShield


class MultiAgentTrafficEnv(ParallelEnv if HAS_PETTINGZOO else object):
    """
    PettingZoo Parallel Multi-Agent Reinforcement Learning Environment.
    Each active vehicle is an independent agent with its own observation, action, and reward.
    """

    metadata = {"render_modes": ["human", "none"], "name": "amapp_traffic_v1"}

    def __init__(
        self,
        scenario_id: str = "police_pursuit",
        dt: float = 0.05,
        max_steps: int = 400,
        enable_shield_in_training: bool = True,
    ) -> None:
        super().__init__()
        from ..engine import SimulationEngine

        self.scenario_id = scenario_id
        self.dt = dt
        self.max_steps = max_steps
        self.enable_shield_in_training = enable_shield_in_training

        self.city = CityLayout()
        self.engine = SimulationEngine(self.city)
        self.obs_builder = ObservationBuilder()
        self.reward_calc = RewardCalculator()
        self.safety_shield = SafetyShield()

        self.current_step = 0
        self.agents: List[str] = []
        self.possible_agents: List[str] = []

        # Action space: [accel, lane_intent, route_choice, v2v_msg, inter_intent]
        self._action_space = spaces.Box(
            low=np.array([-4.5, -1, 0, 0, 0], dtype=np.float32),
            high=np.array([3.5, 1, 2, 3, 2], dtype=np.float32),
            dtype=np.float32,
        )
        self._obs_space = spaces.Box(
            low=-1.0,
            high=1.0,
            shape=(OBSERVATION_DIM,),
            dtype=np.float32,
        )

    def observation_space(self, agent: str) -> spaces.Space:
        return self._obs_space

    def action_space(self, agent: str) -> spaces.Space:
        return self._action_space

    def reset(
        self, seed: Optional[int] = None, options: Optional[dict] = None
    ) -> Tuple[Dict[str, np.ndarray], Dict[str, dict]]:
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)

        scenario = options.get("scenario", self.scenario_id) if options else self.scenario_id
        self.scenario_id = scenario

        # Re-initialize engine with specified scenario
        from ..engine import SimulationEngine
        self.city = CityLayout()
        self.engine = SimulationEngine(self.city)
        self.engine.load_scenario(self.scenario_id)
        self.current_step = 0

        self.agents = [v.id for v in self.engine.vehicles]
        self.possible_agents = list(self.agents)

        obs_dict = {}
        info_dict = {}
        for v in self.engine.vehicles:
            obs_dict[v.id] = self.obs_builder.build(v, self.engine)
            info_dict[v.id] = {"type": v.type, "priority": v.priority}

        return obs_dict, info_dict

    def step(
        self, actions: Dict[str, VehicleAction | np.ndarray]
    ) -> Tuple[
        Dict[str, np.ndarray],
        Dict[str, float],
        Dict[str, bool],
        Dict[str, bool],
        Dict[str, dict],
    ]:
        self.current_step += 1

        # 1. Apply actions to engine vehicles
        for v in self.engine.vehicles:
            if v.id in actions:
                raw_act = actions[v.id]
                if isinstance(raw_act, np.ndarray):
                    action = VehicleAction(
                        accel=float(raw_act[0]),
                        lane_intent=int(round(raw_act[1])),
                        route_choice=int(round(raw_act[2])),
                        v2v_message=int(round(raw_act[3])),
                        intersection_intent=int(round(raw_act[4])),
                    ).clamp()
                else:
                    action = raw_act

                # Run through Safety Shield if enabled
                if self.enable_shield_in_training:
                    verified_act = self.safety_shield.verify_and_correct(v, action, self.engine)
                else:
                    verified_act = action

                # Execute action onto vehicle dynamics
                self._apply_action_to_vehicle(v, verified_act)

        # 2. Advance simulation physics by dt
        self.engine.tick(self.dt)

        # 3. Collect observations, rewards, and terminations
        obs_dict: Dict[str, np.ndarray] = {}
        rewards: Dict[str, float] = {}
        terminations: Dict[str, bool] = {}
        truncations: Dict[str, bool] = {}
        infos: Dict[str, dict] = {}

        is_truncated = self.current_step >= self.max_steps

        # Check vehicle trip completion
        active_ids = {v.id for v in self.engine.vehicles}
        for v in self.engine.vehicles:
            v_id = v.id
            obs_dict[v_id] = self.obs_builder.build(v, self.engine)
            act = actions.get(v_id, VehicleAction())
            if isinstance(act, np.ndarray):
                act = VehicleAction(accel=float(act[0]))

            rewards[v_id] = self.reward_calc.compute_step_reward(v, act, self.engine, self.dt)
            terminations[v_id] = False
            truncations[v_id] = is_truncated
            infos[v_id] = {
                "speed": v.speed,
                "ttc": getattr(v, "ttc", None),
                "distance": v.distance_traveled,
            }

        # Update remaining active agents list
        self.agents = [v.id for v in self.engine.vehicles]

        return obs_dict, rewards, terminations, truncations, infos

    def _apply_action_to_vehicle(self, v: VehicleAgent, action: VehicleAction) -> None:
        """Translates verified VehicleAction into vehicle dynamics parameters."""
        # 1. Longitudinal acceleration integration
        v.acceleration = action.accel
        new_speed = max(0.0, min(v.max_speed, v.speed + action.accel * self.dt))
        v.target_speed = new_speed
        if action.accel < -2.5:
            v.status = "braking"
        elif new_speed < 0.2:
            v.status = "stopped"
        else:
            v.status = "cruising"

        # 2. Lateral lane intent
        if action.lane_intent == 1:
            v.target_lateral_offset = 2.4  # Shoulder pull-over
            v.is_yielding_to_emergency = True
        elif action.lane_intent == -1:
            v.target_lateral_offset = -1.2  # Left overtaking lane
        else:
            v.target_lateral_offset = 0.0  # Centerline
            v.is_yielding_to_emergency = False

        # 3. Route choice
        if action.route_choice != 0 and v.active_incident_detected:
            # Trigger detour replanning
            self.engine._reroute_vehicle_around_incident(v)

        # 4. V2V message broadcasting
        if action.v2v_message == 1:
            v.hazard_lights_active = True
        elif action.v2v_message == 2:
            v.is_platoon_follower = True
        elif action.v2v_message == 3:
            v.siren_active = True
