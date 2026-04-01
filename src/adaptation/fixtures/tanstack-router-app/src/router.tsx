import { createRouter, createRoute, createRootRoute } from "@tanstack/react-router";

const rootRoute = createRootRoute();

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  loader: async () => {
    return fetch("/api/dashboard-data");
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
});

const callbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/oauth/callback",
});

const profileRoute = createFileRoute("/settings/profile");

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    dashboardRoute,
    loginRoute,
    callbackRoute,
  ]),
});
