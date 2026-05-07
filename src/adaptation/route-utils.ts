// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

const LOGIN_SEGMENTS = new Set(['login', 'signin', 'sign-in']);
const CALLBACK_SEGMENTS = new Set(['callback', 'oauth', 'sso']);

export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}

function hasRouteSegment(routePath: string, candidates: Set<string>): boolean {
  const [pathname] = routePath.split('?');
  if (!pathname) {
    return false;
  }

  return pathname
    .split('/')
    .filter(Boolean)
    .some((segment) => candidates.has(segment.toLowerCase()));
}

export function isLoginRoute(routePath: string): boolean {
  return hasRouteSegment(routePath, LOGIN_SEGMENTS);
}

export function isCallbackRoute(routePath: string): boolean {
  return hasRouteSegment(routePath, CALLBACK_SEGMENTS);
}
