import { shortId } from '../constants.js';
import type { Evidence } from '../types.js';

const MAX_RECENT_FAILURES = 5;

export interface ApiProbeDiagnostics {
  attempted: number;
  succeeded: number;
  failed: number;
  recentFailures: string[];
}

export function createApiProbeDiagnostics(): ApiProbeDiagnostics {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    recentFailures: [],
  };
}

export function recordApiProbeSuccess(diagnostics: ApiProbeDiagnostics): void {
  diagnostics.succeeded += 1;
}

export function recordApiProbeFailure(diagnostics: ApiProbeDiagnostics, message: string): void {
  diagnostics.failed += 1;
  diagnostics.recentFailures.push(message);
  if (diagnostics.recentFailures.length > MAX_RECENT_FAILURES) {
    diagnostics.recentFailures = diagnostics.recentFailures.slice(
      diagnostics.recentFailures.length - MAX_RECENT_FAILURES
    );
  }
}

export function formatApiProbeSummary(
  targetCount: number,
  diagnostics: ApiProbeDiagnostics
): string {
  return `Completed api task with ${targetCount} probe target(s); attempted ${diagnostics.attempted}, succeeded ${diagnostics.succeeded}, failed ${diagnostics.failed}`;
}

export function buildApiProbeDiagnosticsEvidence(
  areaName: string,
  diagnostics: ApiProbeDiagnostics
): Evidence | undefined {
  if (diagnostics.failed === 0) {
    return undefined;
  }

  const failureTail = diagnostics.recentFailures.slice(-3).join(' | ');

  return {
    id: `ev-${shortId()}`,
    type: 'api-contract',
    summary: `API probe diagnostics: attempted ${diagnostics.attempted}, succeeded ${diagnostics.succeeded}, failed ${diagnostics.failed}${failureTail ? ` (${failureTail})` : ''}`,
    timestamp: new Date().toISOString(),
    areaName,
    relatedFindingIds: [],
  };
}
