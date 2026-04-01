from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("dashboard/", views.dashboard, name="dashboard"),
    path("login/", views.login_view, name="login"),
    path("oauth/callback/", views.oauth_callback, name="oauth-callback"),
    path("api/users/", views.user_list, name="user-list"),
    path("api/users/<int:pk>/", views.user_detail, name="user-detail"),
]
