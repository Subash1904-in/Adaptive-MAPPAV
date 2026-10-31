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

"""Channels WebSocket consumer for a single simulation session."""

from __future__ import annotations

import asyncio
import json
import time

from channels.generic.websocket import AsyncWebsocketConsumer

from .session_manager import get_or_create_engine


class SimulationConsumer(AsyncWebsocketConsumer):
    """
    Real-time WebSocket consumer broadcasting simulation updates at 30 Hz.
    Receives control commands (scenario change, incidents, rule tuning).
    """

    async def connect(self):
        self.session_id = self.scope["url_route"]["kwargs"].get("session_id", "default")
        self.engine = get_or_create_engine(self.session_id)
        self._running = True
        await self.accept()

        # Send initial connection confirmation
        await self.send(
            text_data=json.dumps({
                "type": "connected",
                "session_id": self.session_id,
                "scenario": self.engine.current_scenario,
            })
        )

        self._task = asyncio.create_task(self._simulation_loop())

    async def disconnect(self, code):
        self._running = False
        task = getattr(self, "_task", None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
            command = data.get("command")
            if command == "load_scenario":
                self.engine.load_scenario(data["scenario_id"])
            elif command == "add_incident":
                self.engine.add_incident(
                    data["type"], data["x"], data["z"], data["radius"], data["label"]
                )
            elif command == "remove_incident":
                self.engine.remove_incident(data["incident_id"])
            elif command == "set_rule":
                if not self.engine.rule_engine.set_preset(data["preset"]):
                    raise ValueError("Unknown rule preset")
            elif command == "set_controller_mode":
                if not self.engine.set_controller_mode(data["mode"]):
                    raise ValueError(f"Failed to set controller mode to {data['mode']}")
            elif command in ("set_v2v_visible", "ping"):
                pass
            else:
                raise ValueError(f"Unknown command: {command}")

            await self.send(text_data=json.dumps({"type": "ack", "command": command}))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            try:
                await self.send(text_data=json.dumps({"type": "error", "error": str(exc)}))
            except Exception:
                pass

    async def _simulation_loop(self):
        target_dt = 1.0 / 30.0  # 30 Hz target rate
        last = time.monotonic()
        try:
            while self._running:
                started = time.monotonic()
                dt = started - last
                last = started
                # Run simulation step in thread pool to avoid blocking async event loop
                await asyncio.to_thread(self.engine.tick, dt)
                state = self.engine.get_full_state()
                try:
                    await self.send(text_data=json.dumps({"type": "state", "data": state}))
                except Exception:
                    # Client disconnected or connection closed
                    break
                elapsed = time.monotonic() - started
                await asyncio.sleep(max(0.001, target_dt - elapsed))
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        finally:
            self._running = False
