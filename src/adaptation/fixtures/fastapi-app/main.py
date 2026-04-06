from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from .auth import get_current_user

app = FastAPI()

class CreateUserSchema(BaseModel):
    name: str
    email: str

@app.get("/")
async def home():
    return {"message": "Welcome"}

@app.get("/dashboard")
async def dashboard(user=Depends(get_current_user)):
    return {"user": user}

@app.get("/login")
async def login_page():
    return {"page": "login"}

@app.get("/oauth/callback")
async def oauth_callback():
    return {"status": "ok"}

@app.get("/api/users", status_code=200)
async def list_users(user=Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return []

@app.post("/api/users", status_code=201)
async def create_user(data: CreateUserSchema, user=Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"id": 1}

@app.get("/api/users/{user_id}")
async def get_user(user_id: int):
    return {"id": user_id}

@app.delete("/api/users/{user_id}")
async def delete_user(user_id: int, user=Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"deleted": True}
