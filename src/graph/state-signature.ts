import type { StateSignature } from "../types.js";

const TRACKING_QUERY_PARAM_PATTERNS = [
  /^utm_/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
];

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/g, "");
  return normalized || "/";
}

function isTrackingQueryParam(key: string): boolean {
  return TRACKING_QUERY_PARAM_PATTERNS.some((pattern) => pattern.test(key));
}

export function normalizeUiMarkers(markers: string[]): string[] {
  return [...new Set(
    markers
      .map((marker) => marker.trim().replace(/\s+/g, " ").toLowerCase())
      .filter(Boolean)
  )].sort();
}

export function buildStateSignatureFromUrl(
  rawUrl: string,
  baseUrl?: string
): StateSignature {
  try {
    const url = new URL(rawUrl, baseUrl ?? "http://placeholder");
    const query = [...url.searchParams.entries()]
      .filter(([key]) => !isTrackingQueryParam(key))
      .sort(([aKey, aValue], [bKey, bValue]) => {
        if (aKey === bKey) return aValue.localeCompare(bValue);
        return aKey.localeCompare(bKey);
      });

    return {
      pathname: normalizePathname(url.pathname),
      query,
      uiMarkers: [],
    };
  } catch {
    return {
      pathname: normalizePathname(rawUrl),
      query: [],
      uiMarkers: [],
    };
  }
}

export function buildStateSignature(
  rawUrl: string,
  uiMarkers: string[],
  baseUrl?: string
): StateSignature {
  const urlSignature = buildStateSignatureFromUrl(rawUrl, baseUrl);
  return {
    ...urlSignature,
    uiMarkers: normalizeUiMarkers(uiMarkers),
  };
}

export function buildStateSignatureKey(signature: StateSignature): string {
  const queryKey = signature.query
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const uiKey = signature.uiMarkers.join(",");

  return `${signature.pathname}?${queryKey}#${uiKey}`;
}

export function signaturesEqual(
  left: StateSignature,
  right: StateSignature
): boolean {
  return buildStateSignatureKey(left) === buildStateSignatureKey(right);
}

export function hasPathOnlyStateSignature(signature: StateSignature): boolean {
  return signature.query.length === 0 && signature.uiMarkers.length === 0;
}
