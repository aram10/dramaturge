import type { CoverageSnapshot, WorkerResult } from '../types.js';
import { stripRedactedHeaders, stripRedactedValue } from '../redaction.js';
import { buildAuthBoundaryFailureArtifacts, buildContractReplayArtifacts } from './assertions.js';
import {
  buildApiProbeDiagnosticsEvidence,
  createApiProbeDiagnostics,
  formatApiProbeSummary,
  recordApiProbeFailure,
  recordApiProbeSuccess,
} from './diagnostics.js';
import { selectApiProbeTargets } from './correlation.js';
import { buildProbeCases, filterProbeTargets } from './probes.js';
import { replayApiRequest } from './replay.js';
import type { ExecuteApiWorkerTaskInput } from './types.js';

function createEmptyCoverageSnapshot(): CoverageSnapshot {
  return {
    controlsDiscovered: 0,
    controlsExercised: 0,
    events: [],
  };
}

export async function executeApiWorkerTask(
  input: ExecuteApiWorkerTaskInput
): Promise<WorkerResult> {
  const findings: WorkerResult['findings'] = [];
  const evidence: WorkerResult['evidence'] = [];
  const diagnostics = createApiProbeDiagnostics();
  const targets = filterProbeTargets(
    selectApiProbeTargets({
      pageRoute: input.pageRoute,
      observedEndpoints: input.observedEndpoints,
      contractIndex: input.contractIndex,
      maxEndpoints: input.config.maxEndpointsPerNode,
    }),
    input.config
  );

  if (!input.config.enabled || targets.length === 0) {
    return {
      taskId: input.taskId,
      findings,
      evidence,
      coverageSnapshot: createEmptyCoverageSnapshot(),
      followupRequests: [],
      discoveredEdges: [],
      outcome: 'completed',
      summary: 'No eligible API probes for this node',
    };
  }

  const isolatedContext =
    input.config.unauthenticatedProbes && input.createIsolatedRequestContext
      ? await input.createIsolatedRequestContext().catch(() => undefined)
      : undefined;

  try {
    for (const target of targets) {
      const cases = buildProbeCases(target, input.config);
      const url = new URL(target.route, input.targetUrl).href;

      for (const probeCase of cases) {
        diagnostics.attempted += 1;
        const requestContext = probeCase.isolated
          ? isolatedContext
          : input.authenticatedRequestContext;
        if (!requestContext) {
          recordApiProbeFailure(
            diagnostics,
            probeCase.isolated
              ? `Missing isolated request context for ${target.method} ${target.route}`
              : `Missing authenticated request context for ${target.method} ${target.route}`
          );
          continue;
        }

        try {
          const response = await replayApiRequest(requestContext, {
            url: target.sample?.url ? new URL(target.sample.url, input.targetUrl).href : url,
            method: target.method,
            headers: stripRedactedHeaders(target.sample?.headers),
            data: stripRedactedValue(target.sample?.data),
          });
          recordApiProbeSuccess(diagnostics);

          if (!probeCase.isolated) {
            const contractArtifacts = buildContractReplayArtifacts({
              areaName: input.areaName,
              pageRoute: input.pageRoute,
              target,
              response,
              contractIndex: input.contractIndex,
            });
            if (contractArtifacts) {
              findings.push(contractArtifacts.finding);
              evidence.push(contractArtifacts.evidence);
            }
            continue;
          }

          const authArtifacts = buildAuthBoundaryFailureArtifacts({
            areaName: input.areaName,
            pageRoute: input.pageRoute,
            target,
            response,
          });
          if (authArtifacts) {
            findings.push(authArtifacts.finding);
            evidence.push(authArtifacts.evidence);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordApiProbeFailure(
            diagnostics,
            `${probeCase.name} ${target.method} ${target.route}: ${message}`
          );
        }
      }
    }
  } finally {
    await isolatedContext?.dispose?.();
  }

  const diagnosticsEvidence = buildApiProbeDiagnosticsEvidence(input.areaName, diagnostics);
  if (diagnosticsEvidence) {
    evidence.push(diagnosticsEvidence);
  }

  return {
    taskId: input.taskId,
    findings,
    evidence,
    coverageSnapshot: createEmptyCoverageSnapshot(),
    followupRequests: [],
    discoveredEdges: [],
    outcome: 'completed',
    summary: formatApiProbeSummary(targets.length, diagnostics),
  };
}
