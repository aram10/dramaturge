from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from rest_framework.decorators import api_view
from rest_framework.response import Response

def home(request):
    return render(request, "home.html")

@login_required
def dashboard(request):
    return render(request, "dashboard.html")

def login_view(request):
    return render(request, "login.html")

def oauth_callback(request):
    return render(request, "callback.html")

@api_view(["GET", "POST"])
def user_list(request):
    if request.method == "POST":
        return Response(status=201)
    return Response(status=200)

def user_detail(request, pk):
    return Response(status=200)
