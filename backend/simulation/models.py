"""Small persistence models for completed simulation runs and metrics."""

from django.db import models


class SimulationRun(models.Model):
    scenario = models.CharField(max_length=64)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    total_vehicles = models.PositiveIntegerField(default=0)
    completed_trips = models.PositiveIntegerField(default=0)


class MetricsSnapshot(models.Model):
    run = models.ForeignKey(SimulationRun, on_delete=models.CASCADE, related_name="metrics")
    sim_time = models.FloatField()
    active_vehicles = models.PositiveIntegerField(default=0)
    throughput_per_min = models.FloatField(default=0)
    recorded_at = models.DateTimeField(auto_now_add=True)


class VehicleLog(models.Model):
    run = models.ForeignKey(SimulationRun, on_delete=models.CASCADE, related_name="vehicle_logs")
    vehicle_id = models.CharField(max_length=64)
    vehicle_type = models.CharField(max_length=32)
    final_status = models.CharField(max_length=32)
    recorded_at = models.DateTimeField(auto_now_add=True)


class BenchmarkResult(models.Model):
    run = models.ForeignKey(SimulationRun, on_delete=models.CASCADE, related_name="benchmarks")
    scenario = models.CharField(max_length=64)
    avg_throughput = models.FloatField(default=0)
    avg_delay = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
