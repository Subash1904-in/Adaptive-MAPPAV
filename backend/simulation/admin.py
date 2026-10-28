# Copyright 2024 The AMAPP Authors
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

"""Django admin registrations for the simulation app."""

from django.contrib import admin

from simulation.models import (
    BenchmarkResult,
    MetricsSnapshot,
    SimulationRun,
    VehicleLog,
)


@admin.register(SimulationRun)
class SimulationRunAdmin(admin.ModelAdmin):
    """Admin view for SimulationRun records."""

    list_display = ("id", "scenario", "started_at", "ended_at", "total_vehicles", "completed_trips")
    list_filter = ("scenario",)
    ordering = ("-started_at",)


@admin.register(MetricsSnapshot)
class MetricsSnapshotAdmin(admin.ModelAdmin):
    """Admin view for per-tick MetricsSnapshot records."""

    list_display = ("id", "run", "sim_time", "active_vehicles", "throughput_per_min", "recorded_at")
    list_filter = ("run",)
    ordering = ("-recorded_at",)


@admin.register(VehicleLog)
class VehicleLogAdmin(admin.ModelAdmin):
    """Admin view for per-vehicle VehicleLog records."""

    list_display = ("id", "run", "vehicle_id", "vehicle_type", "final_status", "recorded_at")
    list_filter = ("vehicle_type", "final_status")
    ordering = ("-recorded_at",)


@admin.register(BenchmarkResult)
class BenchmarkResultAdmin(admin.ModelAdmin):
    """Admin view for BenchmarkResult records."""

    list_display = ("id", "run", "scenario", "avg_throughput", "avg_delay", "created_at")
    list_filter = ("scenario",)
    ordering = ("-created_at",)
