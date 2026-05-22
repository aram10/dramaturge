// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { ConfirmationVerdict, Evidence, Finding, FindingConfidence } from '../types.js';

export interface FindingQualityScore {
  total: number;
  components: {
    hasUrl: boolean;
    hasReproActions: boolean;
    hasExpectedActual: boolean;
    hasScreenshot: boolean;
    hasNetworkOrConsole: boolean;
    hasA11ySource: boolean;
    confidence: FindingConfidence;
    confirmationVerdict?: Extract<
      ConfirmationVerdict,
      'fixed' | 'still_reproducible' | 'cannot_confirm'
    >;
  };
  promotable: boolean;
}

export interface ScoreFindingQualityOptions {
  finding: Pick<
    Finding,
    | 'actual'
    | 'evidenceIds'
    | 'expected'
    | 'id'
    | 'meta'
    | 'occurrences'
    | 'ref'
    | 'screenshot'
    | 'screenshotRef'
  >;
  evidence?: Evidence[];
  confirmationVerdict?: FindingQualityScore['components']['confirmationVerdict'];
  threshold?: number;
}

const DEFAULT_PROMOTABLE_THRESHOLD = 60;

function confidencePoints(confidence: FindingConfidence): number {
  switch (confidence) {
    case 'high':
      return 15;
    case 'medium':
      return 10;
    case 'low':
      return 0;
  }
}

function hasText(value: string | undefined): boolean {
  return (value ?? '').trim().length > 0;
}

function hasExpectedActual(finding: ScoreFindingQualityOptions['finding']): boolean {
  return (
    hasText(finding.expected) && hasText(finding.actual) && finding.expected !== finding.actual
  );
}

function linkedEvidence(
  finding: ScoreFindingQualityOptions['finding'],
  evidence: Evidence[]
): Evidence[] {
  const linkedEvidenceIds = new Set([
    ...(finding.evidenceIds ?? []),
    ...(finding.meta?.repro?.evidenceIds ?? []),
    ...finding.occurrences.flatMap((occurrence) => occurrence.evidenceIds),
  ]);

  return evidence.filter(
    (item) =>
      linkedEvidenceIds.has(item.id) ||
      item.relatedFindingIds.includes(finding.id) ||
      (finding.ref != null && item.relatedFindingIds.includes(finding.ref))
  );
}

function buildQualityComponents(
  finding: ScoreFindingQualityOptions['finding'],
  evidence: Evidence[],
  confirmationVerdict: ScoreFindingQualityOptions['confirmationVerdict']
): FindingQualityScore['components'] {
  const hasScreenshotEvidence = evidence.some(
    (item) => item.type === 'screenshot' || item.type === 'visual-diff'
  );
  const hasNetworkOrConsole = evidence.some(
    (item) => item.type === 'network-error' || item.type === 'console-error'
  );
  const components: FindingQualityScore['components'] = {
    hasUrl:
      finding.occurrences.some((occurrence) => hasText(occurrence.route)) ||
      hasText(finding.meta?.repro?.route),
    hasReproActions: (finding.meta?.repro?.actionIds?.length ?? 0) > 0,
    hasExpectedActual: hasExpectedActual(finding),
    hasScreenshot:
      hasText(finding.screenshot) || hasText(finding.screenshotRef) || hasScreenshotEvidence,
    hasNetworkOrConsole,
    hasA11ySource: evidence.some((item) => item.type === 'accessibility-scan'),
    confidence: finding.meta?.confidence ?? 'low',
  };

  if (confirmationVerdict) {
    components.confirmationVerdict = confirmationVerdict;
  }

  return components;
}

function totalQualityPoints(components: FindingQualityScore['components']): number {
  return (
    (components.hasUrl ? 10 : 0) +
    (components.hasReproActions ? 25 : 0) +
    (components.hasExpectedActual ? 15 : 0) +
    (components.hasScreenshot ? 10 : 0) +
    (components.hasNetworkOrConsole ? 10 : 0) +
    (components.hasA11ySource ? 5 : 0) +
    confidencePoints(components.confidence) +
    (components.confirmationVerdict === 'fixed' ? 10 : 0)
  );
}

export function scoreFindingQuality(options: ScoreFindingQualityOptions): FindingQualityScore {
  const { finding, confirmationVerdict, threshold = DEFAULT_PROMOTABLE_THRESHOLD } = options;
  const evidence = linkedEvidence(finding, options.evidence ?? []);
  const components = buildQualityComponents(finding, evidence, confirmationVerdict);
  const total = totalQualityPoints(components);

  return {
    total,
    components,
    promotable: total >= threshold && components.hasReproActions && components.hasExpectedActual,
  };
}
