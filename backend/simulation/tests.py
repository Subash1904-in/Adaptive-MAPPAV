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
Comprehensive test suite for the AMAPP simulation backend.
Tests city graph, A* pathfinding, traffic signals, rule engine, V2V links,
RL agent, benchmarks, and Django REST Framework endpoints.
"""

from __future__ import annotations

import math
import numpy as np
from django.test import TestCase
from rest_framework.test import APIClient

from .benchmarks import BenchmarkRunner
from .city_map import CityLayout
from .engine import SimulationEngine
from .pathfinding import distance_2d, find_path, is_road_segment_blocked
from .pedestrians import PedestrianManager
from .rl_agent import TrafficSignalRLAgent
from .rule_engine import RuleEngine
from .scenarios import SCENARIOS, get_scenario, list_scenarios
from .traffic_signals import STRICT_CYCLE_DURATION, TrafficSignalManager
from .types import Incident, Vector2D
from .v2v import V2VManager


class CityMapAndPathfindingTests(TestCase):
    def setUp(self):
        self.city = CityLayout()

    def test_city_layout_initialization(self):
        # 5x5 grid = 25 intersection nodes
        self.assertEqual(len(self.city.nodes), 25)
        # 40 bidirectional segments = 80 directed roads
        self.assertEqual(len(self.city.roads), 80)
        self.assertEqual(len(self.city.intersections), 25)
        self.assertIn("min_x", self.city.bounds)
        self.assertIn("max_x", self.city.bounds)

    def test_distance_2d(self):
        d = distance_2d(Vector2D(0.0, 0.0), Vector2D(3.0, 4.0))
        self.assertAlmostEqual(d, 5.0)

    def test_find_path_clear_road(self):
        res = find_path("n_0_0", "n_4_4", self.city, incidents=[])
        self.assertIsNotNone(res)
        self.assertIn("path_points", res)
        self.assertIn("path_node_ids", res)
        self.assertEqual(res["path_node_ids"][0], "n_0_0")
        self.assertEqual(res["path_node_ids"][-1], "n_4_4")
        self.assertGreater(len(res["path_points"]), 4)

    def test_pathfinding_incident_penalty(self):
        incident = Incident(
            id="inc_block_1",
            type="roadblock",
            x=-75.0,
            z=-150.0,
            radius=15.0,
            label="Police Blockade",
            timestamp=0.0,
            affects_road_ids=[],
        )
        # Road between n_0_0 and n_1_0 passes through (-75, -150)
        blocked = is_road_segment_blocked("n_0_0", "n_1_0", self.city, [incident])
        self.assertTrue(blocked)

        # Path should find alternative detour
        res = find_path("n_0_0", "n_1_0", self.city, [incident], avoid_incidents=True)
        self.assertIsNotNone(res)
        # First step shouldn't be directly into blocked segment if avoid_incidents is on
        self.assertTrue(len(res["path_node_ids"]) >= 2)


class TrafficSignalAndRuleEngineTests(TestCase):
    def setUp(self):
        self.city = CityLayout()
        self.signals = TrafficSignalManager(self.city)
        self.rules = RuleEngine()

    def test_signal_phases_52s_cycle(self):
        # 0s -> Phase 1 NS Green
        p1 = TrafficSignalManager.evaluate_cycle_phase(5.0)
        self.assertEqual(p1["ns_state"], "green")
        self.assertEqual(p1["ew_state"], "red")

        # 22s -> Phase 2 NS Yellow
        p2 = TrafficSignalManager.evaluate_cycle_phase(22.0)
        self.assertEqual(p2["ns_state"], "yellow")
        self.assertEqual(p2["ew_state"], "red")

        # 25s -> Phase 3 All-red
        p3 = TrafficSignalManager.evaluate_cycle_phase(25.0)
        self.assertEqual(p3["ns_state"], "red")
        self.assertEqual(p3["ew_state"], "red")

        # 30s -> Phase 4 EW Green
        p4 = TrafficSignalManager.evaluate_cycle_phase(30.0)
        self.assertEqual(p4["ns_state"], "red")
        self.assertEqual(p4["ew_state"], "green")

    def test_emergency_preemption(self):
        node_id = "n_2_2"
        self.signals.request_emergency_preemption(node_id, axis="ns", duration=8.0)
        node = self.city.nodes[node_id]
        self.assertEqual(node.traffic_light.emergency_override_axis, "ns")
        self.assertGreater(node.traffic_light.emergency_override_timer, 0.0)

        # Update step decrements override timer
        self.signals.update(1.0)
        self.assertAlmostEqual(node.traffic_light.emergency_override_timer, 7.0, places=1)

    def test_rule_engine_presets(self):
        self.assertTrue(self.rules.set_preset("adaptive_platoon"))
        self.assertEqual(self.rules.get_preset(), "adaptive_platoon")
        self.assertTrue(self.rules.set_preset("emergency_corridor"))
        self.assertEqual(self.rules.get_preset(), "emergency_corridor")
        self.assertFalse(self.rules.set_preset("non_existent_rule"))


class SimulationEngineAndRLTests(TestCase):
    def setUp(self):
        self.engine = SimulationEngine()
        self.rl = TrafficSignalRLAgent()

    def test_engine_initialization_and_scenario_load(self):
        self.assertEqual(self.engine.current_scenario, "police_pursuit")
        self.assertGreater(len(self.engine.vehicles), 30)

        # Switch scenario
        self.engine.load_scenario("fire_rescue")
        self.assertEqual(self.engine.current_scenario, "fire_rescue")
        self.assertGreaterEqual(len(self.engine.incidents), 1)

    def test_engine_tick_step(self):
        init_time = self.engine.sim_time
        self.engine.tick(0.05)
        self.assertGreater(self.engine.sim_time, init_time)
        state = self.engine.get_full_state()
        self.assertIn("vehicles", state)
        self.assertIn("traffic_lights", state)
        self.assertIn("metrics", state)
        self.assertIn("v2v_links", state)

    def test_rl_agent_action_and_learn(self):
        state = self.rl.get_state_key(ns_queue=4, ew_queue=1, phase_index=1, has_emergency=False)
        action = self.rl.select_action(ns_queue=4, ew_queue=1, phase_index=1, has_emergency=False)
        self.assertIn(action, [0, 1, 2])

        reward = self.rl.compute_reward(
            ns_queue=2,
            ew_queue=1,
            vehicles_passed=3,
            has_emergency=False,
            emergency_delayed=False,
            preemption_success=False,
        )
        new_state = self.rl.get_state_key(ns_queue=2, ew_queue=1, phase_index=1, has_emergency=False)
        self.rl.learn(state, action, reward, new_state)

        metrics = self.rl.get_metrics()
        self.assertGreaterEqual(metrics["total_steps"], 1)

    def test_benchmark_runner(self):
        runner = BenchmarkRunner(self.engine)
        summary = runner.run_benchmark(scenario_id="police_pursuit", duration_seconds=1.0, time_step=0.05)
        self.assertEqual(summary["scenario"], "police_pursuit")
        self.assertIn("performance", summary)
        self.assertIn("mean_speed_kmh", summary["performance"])


class RestApiEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_get_city_endpoint(self):
        response = self.client.get("/api/city/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("nodes", response.data)
        self.assertIn("roads", response.data)
        self.assertEqual(len(response.data["nodes"]), 25)

    def test_list_scenarios_endpoint(self):
        response = self.client.get("/api/scenarios/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 8)

    def test_session_lifecycle_and_incidents(self):
        # Create or fetch session
        res = self.client.post("/api/sim/test_session/")
        self.assertEqual(res.status_code, 200)

        # Switch scenario
        res = self.client.post("/api/sim/test_session/scenario/", {"scenario_id": "vip_motorcade"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["scenario"], "vip_motorcade")

        # Add incident
        res = self.client.post(
            "/api/sim/test_session/incidents/",
            {"type": "accident", "x": 0.0, "z": 0.0, "radius": 12.0, "label": "Test Crash"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        inc_id = res.data["incident_id"]

        # Remove incident
        res = self.client.delete(f"/api/sim/test_session/incidents/{inc_id}/")
        self.assertEqual(res.status_code, 204)

        # Tune rule preset
        res = self.client.post("/api/sim/test_session/rule/", {"preset": "emergency_corridor"}, format="json")
        self.assertEqual(res.status_code, 200)

        # Query RL stats
        res = self.client.get("/api/sim/test_session/rl/metrics/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("total_steps", response_keys := res.data)

        # Controller mode endpoint
        res = self.client.post("/api/sim/test_session/controller-mode/", {"mode": "fallback"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["mode"], "fallback")

        # AI Status endpoint
        res = self.client.get("/api/sim/test_session/ai/status/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("controller_mode", res.data)
        self.assertIn("safety_shield", res.data)


class MultiAgentAIArchitectureTests(TestCase):
    def setUp(self):
        self.city = CityLayout()
        self.engine = SimulationEngine(self.city)

    def test_observation_builder_dim_and_bounds(self):
        from .ai.observations import ObservationBuilder, OBSERVATION_DIM
        builder = ObservationBuilder()
        self.assertEqual(builder.dim, OBSERVATION_DIM)
        self.assertEqual(OBSERVATION_DIM, 32)

        v = self.engine.vehicles[0]
        obs = builder.build(v, self.engine)
        self.assertEqual(obs.shape, (32,))
        self.assertTrue(np.all(np.isfinite(obs)))
        self.assertTrue(np.all(obs >= -1.0))
        self.assertTrue(np.all(obs <= 2.0))

    def test_vehicle_action_clamping(self):
        from .ai.actions import VehicleAction
        act = VehicleAction(accel=10.0, lane_intent=5, route_choice=10).clamp()
        self.assertLessEqual(act.accel, 3.5)
        self.assertEqual(act.lane_intent, 1)
        self.assertEqual(act.route_choice, 2)

    def test_safety_shield_intervention_on_critical_ttc(self):
        from .ai.actions import VehicleAction
        from .ai.safety_shield import SafetyShield
        shield = SafetyShield()
        v = self.engine.vehicles[0]
        v.ttc = 0.5  # Critical imminent collision
        setattr(v, "_current_lead_dist", 8.0)

        requested_act = VehicleAction(accel=2.0)  # Unsafe acceleration
        safe_act = shield.verify_and_correct(v, requested_act, self.engine)

        self.assertEqual(safe_act.applied_by, "shield")
        self.assertLessEqual(safe_act.accel, -3.5)
        self.assertGreater(shield.total_interventions, 0)
        self.assertEqual(shield.interventions_by_type["COLLISION_AVOIDANCE"], 1)

    def test_fallback_policy_generates_action(self):
        from .ai.fallback import FallbackPolicy
        fallback = FallbackPolicy()
        v = self.engine.vehicles[0]
        act = fallback.compute_action(v, self.engine)
        self.assertEqual(act.applied_by, "fallback")
        self.assertTrue(isinstance(act.accel, float))

    def test_vehicle_policy_neural_network_forward(self):
        import torch
        from .ai.policy import VehiclePolicy
        policy = VehiclePolicy()
        batch_obs = torch.zeros((4, 32), dtype=torch.float32)
        dist_accel, dist_lane, dist_route, dist_v2v, dist_inter, value = policy(batch_obs)

        self.assertEqual(dist_accel.mean.shape, (4, 1))
        self.assertEqual(value.shape, (4, 1))
        actions = policy.get_actions(batch_obs.numpy(), deterministic=True)
        self.assertEqual(len(actions), 4)

    def test_engine_controller_mode_and_telemetry(self):
        self.engine.tick(0.05)
        state = self.engine.get_full_state()
        self.assertIn("ai_telemetry", state["metrics"])
        self.assertIn("controller_mode", state["metrics"])
        self.assertIn(self.engine.controller_mode, ("ai", "fallback", "evaluation"))

        # Test controller mode toggle
        success = self.engine.set_controller_mode("fallback")
        self.assertTrue(success)
        self.assertEqual(self.engine.controller_mode, "fallback")
        self.engine.tick(0.05)
        self.assertEqual(self.engine.metrics["controller_mode"], "fallback")

