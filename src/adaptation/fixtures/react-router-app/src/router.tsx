import { createBrowserRouter } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { OAuthCallback } from "./pages/OAuthCallback";
import { UserProfile } from "./pages/UserProfile";
import { publicLoader } from "./loaders";

export const router = createBrowserRouter([
  { path: "/", element: <Dashboard /> },
  { path: "/dashboard", element: <Dashboard /> },
  { path: "/settings", element: <Settings /> },
  { path: "/login", element: <Login />, loader: publicLoader },
  { path: "/oauth/callback", element: <OAuthCallback /> },
  { path: "/users/:id", element: <UserProfile /> },
]);
