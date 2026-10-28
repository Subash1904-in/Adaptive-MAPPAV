from django.urls import re_path

from .consumers import SimulationConsumer

websocket_urlpatterns = [
    re_path(r"^ws/sim/(?P<session_id>[^/]+)/$", SimulationConsumer.as_asgi()),
]
