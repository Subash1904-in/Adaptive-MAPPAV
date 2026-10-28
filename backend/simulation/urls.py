from django.urls import path

from . import views

urlpatterns = [
    path("city/", views.get_city),
    path("scenarios/", views.list_scenarios),
    path("sim/<str:session_id>/", views.create_session),
    path("sim/<str:session_id>/scenario/", views.load_scenario),
    path("sim/<str:session_id>/incidents/", views.add_incident),
    path("sim/<str:session_id>/incidents/<str:incident_id>/", views.remove_incident),
    path("sim/<str:session_id>/rule/", views.set_rule),
    path("sim/<str:session_id>/export/", views.export_logs),
    path("sim/<str:session_id>/benchmark/", views.benchmark),
    path("sim/<str:session_id>/rl/metrics/", views.rl_metrics),
]
