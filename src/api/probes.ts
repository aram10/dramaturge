import type { ApiProbeTarget, ApiTestingConfig } from './types.js';

export interface ApiProbeCase {
  name: 'authenticated' | 'unauthenticated';
  isolated: boolean;
}

const SAFE_PROBE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeProbeMethod(method: string): boolean {
  return SAFE_PROBE_METHODS.has(method.toUpperCase());
}

export function filterProbeTargets(
  targets: ApiProbeTarget[],
  config: ApiTestingConfig
): ApiProbeTarget[] {
  return targets
    .filter((target) => config.allowMutatingProbes || isSafeProbeMethod(target.method))
    .slice(0, config.maxEndpointsPerNode);
}

export function buildProbeCases(target: ApiProbeTarget, config: ApiTestingConfig): ApiProbeCase[] {
  const cases: ApiProbeCase[] = [{ name: 'authenticated', isolated: false }];

  if (config.unauthenticatedProbes && target.authRequired) {
    cases.push({ name: 'unauthenticated', isolated: true });
  }

  return cases.slice(0, config.maxProbeCasesPerEndpoint);
}
