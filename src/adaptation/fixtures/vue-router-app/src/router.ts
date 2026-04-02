import { createRouter, createWebHistory } from "vue-router";
import Dashboard from "./pages/Dashboard.vue";
import Settings from "./pages/Settings.vue";
import Login from "./pages/Login.vue";
import OAuthCallback from "./pages/OAuthCallback.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Dashboard },
    { path: "/dashboard", component: Dashboard },
    { path: "/settings", component: Settings },
    { path: "/login", component: Login },
    { path: "/oauth/callback", component: OAuthCallback },
    { path: "/users/:id", component: () => import("./pages/UserProfile.vue") },
  ],
});
