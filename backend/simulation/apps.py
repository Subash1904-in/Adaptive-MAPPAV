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

"""AppConfig for the simulation Django application."""

from django.apps import AppConfig


class SimulationConfig(AppConfig):
    """Configuration class for the AMAPP simulation app.

    Registers the ``simulation`` app with Django and sets the default
    primary-key type to ``BigAutoField`` for all models in this app.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "simulation"
    verbose_name = "AMAPP Simulation"
