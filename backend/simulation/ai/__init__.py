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
AMAPP Multi-Agent AI Control & Learning Suite.
Centralized training with decentralized execution (CTDE), safety shields, and verified baselines.
"""

from .actions import VehicleAction
from .environment import MultiAgentTrafficEnv
from .evaluator import PolicyEvaluator
from .fallback import FallbackPolicy
from .observations import ObservationBuilder, OBSERVATION_DIM
from .policy import VehiclePolicy
from .registry import ModelRegistry
from .rewards import RewardCalculator
from .safety_shield import SafetyShield
from .training import TrainingManager

__all__ = [
    "VehicleAction",
    "VehiclePolicy",
    "ObservationBuilder",
    "OBSERVATION_DIM",
    "MultiAgentTrafficEnv",
    "RewardCalculator",
    "SafetyShield",
    "FallbackPolicy",
    "ModelRegistry",
    "TrainingManager",
    "PolicyEvaluator",
]
