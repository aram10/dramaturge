import type { CoverageSnapshot, WorkerResult } from "../types.js";
import { buildAuthBoundaryFailureArtifacts, buildContractReplayArtifacts } from "./assertions.js";
import { selectApiProbeTargets } from "./correlation.js";
import { buildProbeCases, filterProbeTargets } from "./probes.js";
import { replayApiRequest } from "./replay.js";
import type { ExecuteApiWorkerTaskInput } from "./types.js";

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
  const findings: WorkerResult["findings"] = [];
  const evidence: WorkerResult["evidence"] = [];
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
      outcome: "completed",
      summary: "No eligible API probes for this node",
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
        try {
          const response = await replayApiRequest(
            probeCase.isolated ? isolatedContext ?? input.pageRequestContext : input.pageRequestContext,
            {
              url,
              method: target.method,
            }
          );

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
        } catch {
          // Keep the worker conservative on probe failures: record what succeeds and
          // avoid turning transient transport issues into duplicate findings here.
        }
      }
    }
  } finally {
    await isolatedContext?.dispose?.();
  }

  return {
    taskId: input.taskId,
    findings,
    evidence,
    coverageSnapshot: createEmptyCoverageSnapshot(),
    followupRequests: [],
    discoveredEdges: [],
    outcome: "completed",
    summary: `Completed api task with ${targets.length} probe target(s)`,
  };
}
