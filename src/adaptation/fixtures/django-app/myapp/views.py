from django.contrib.auth.decorators import login_required
from rest_framework.decorators import api_view

def home(request):
    return render(request, "home.html")

@login_required
def dashboard(request):
    return render(request, "dashboard.html")

@api_view(["GET", "POST"])
def user_list(request):
    if request.method == "POST":
        return Response(status=201)
    return Response(status=200)
