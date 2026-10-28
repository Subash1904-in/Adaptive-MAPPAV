from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="SimulationRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scenario", models.CharField(max_length=64)),
                ("started_at", models.DateTimeField(auto_now_add=True)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("total_vehicles", models.PositiveIntegerField(default=0)),
                ("completed_trips", models.PositiveIntegerField(default=0)),
            ],
        ),
        migrations.CreateModel(
            name="MetricsSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sim_time", models.FloatField()),
                ("active_vehicles", models.PositiveIntegerField(default=0)),
                ("throughput_per_min", models.FloatField(default=0)),
                ("recorded_at", models.DateTimeField(auto_now_add=True)),
                ("run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="metrics", to="simulation.simulationrun")),
            ],
        ),
        migrations.CreateModel(
            name="VehicleLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("vehicle_id", models.CharField(max_length=64)),
                ("vehicle_type", models.CharField(max_length=32)),
                ("final_status", models.CharField(max_length=32)),
                ("recorded_at", models.DateTimeField(auto_now_add=True)),
                ("run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="vehicle_logs", to="simulation.simulationrun")),
            ],
        ),
        migrations.CreateModel(
            name="BenchmarkResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scenario", models.CharField(max_length=64)),
                ("avg_throughput", models.FloatField(default=0)),
                ("avg_delay", models.FloatField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="benchmarks", to="simulation.simulationrun")),
            ],
        ),
    ]
