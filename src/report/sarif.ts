// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Evidence, Finding, FindingCategory, FindingSeverity, RunResult } from '../types.js';
import { collectFindings } from './collector.js';

const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

const SEVERITY_TO_LEVEL: Record<FindingSeverity, 'error' | 'warning' | 'note'> = {
  Critical: 'error',
  Major: 'error',
  Minor: 'warning',
  Trivial: 'note',
};

const CATEGORY_RULE_ID: Record<FindingCategory, string> = {
  Bug: 'dramaturge.bug',
  'UX Concern': 'dramaturge.ux',
  'Accessibility Issue': 'dramaturge.a11y',
  'Performance Issue': 'dramaturge.performance',
  'Visual Glitch': 'dramaturge.visual',
};

const CATEGORY_RULE_DESCRIPTION: Record<FindingCategory, string> = {
  Bug: 'Functional defect identified during exploratory QA.',
  'UX Concern': 'User experience concern identified during exploratory QA.',
  'Accessibility Issue': 'Accessibility issue identified during exploratory QA.',
  'Performance Issue': 'Performance issue identified during exploratory QA.',
  'Visual Glitch': 'Visual glitch identified during exploratory QA.',
};

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  defaultConfiguration: { level: 'error' | 'warning' | 'note' };
  helpUri?: string;
}

interface SarifArtifactLocation {
  uri: string;
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  properties: Record<string, unknown>;
  locations?: Array<{
    physicalLocation: {
      artifactLocation: SarifArtifactLocation;
    };
  }>;
  partialFingerprints?: Record<string, string>;
}

function toSafeUri(value: string): string | undefined {
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function buildMessage(finding: Finding): string {
  const parts: string[] = [finding.title];
  if (finding.expected || finding.actual) {
    parts.push(`Expected: ${finding.expected}`);
    parts.push(`Actual: ${finding.actual}`);
  }
  if (finding.stepsToReproduce.length > 0) {
    parts.push(
      'Steps:\n' + finding.stepsToReproduce.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n')
    );
  }
  return parts.join('\n\n');
}

function buildRules(findings: Finding[]): SarifRule[] {
  const seen = new Set<FindingCategory>();
  for (const finding of findings) {
    seen.add(finding.category);
  }
  const rules: SarifRule[] = [];
  for (const category of seen) {
    rules.push({
      id: CATEGORY_RULE_ID[category],
      name: category.replace(/\s+/g, ''),
      shortDescription: { text: category },
      fullDescription: { text: CATEGORY_RULE_DESCRIPTION[category] },
      defaultConfiguration: { level: 'warning' },
      helpUri: 'https://github.com/aram10/dramaturge',
    });
  }
  return rules;
}

function buildLocations(
  finding: Finding,
  evidenceById: Map<string, Evidence>
): SarifResult['locations'] {
  const locations: NonNullable<SarifResult['locations']> = [];
  const routes = new Set<string>();
  for (const occurrence of finding.occurrences) {
    if (occurrence.route) routes.add(occurrence.route);
  }
  for (const route of routes) {
    const uri = toSafeUri(route);
    if (uri) {
      locations.push({ physicalLocation: { artifactLocation: { uri } } });
    }
  }
  // Screenshot artifacts attached as additional locations when available.
  const screenshotEvidence = (finding.evidenceIds ?? [])
    .map((id) => evidenceById.get(id))
    .filter((ev): ev is Evidence => Boolean(ev && ev.path));
  for (const evidence of screenshotEvidence) {
    locations.push({
      physicalLocation: { artifactLocation: { uri: evidence.path! } },
    });
  }
  return locations.length > 0 ? locations : undefined;
}

export function renderSarif(result: RunResult): string {
  const findings = collectFindings(result.areaResults);
  const evidenceById = new Map<string, Evidence>();
  for (const area of result.areaResults) {
    for (const evidence of area.evidence) {
      evidenceById.set(evidence.id, evidence);
    }
  }

  const rules = buildRules(findings);
  const results: SarifResult[] = findings.map((finding) => {
    const sarifResult: SarifResult = {
      ruleId: CATEGORY_RULE_ID[finding.category],
      level: SEVERITY_TO_LEVEL[finding.severity],
      message: { text: buildMessage(finding) },
      properties: {
        'dramaturge.id': finding.id,
        'dramaturge.severity': finding.severity,
        'dramaturge.category': finding.category,
        'dramaturge.area': finding.area,
        'dramaturge.occurrenceCount': finding.occurrenceCount,
        'dramaturge.impactedAreas': finding.impactedAreas,
      },
      partialFingerprints: {
        'dramaturge/v1': finding.id,
      },
    };
    const locations = buildLocations(finding, evidenceById);
    if (locations) {
      sarifResult.locations = locations;
    }
    return sarifResult;
  });

  const sarif = {
    version: SARIF_VERSION,
    $schema: SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: 'dramaturge',
            informationUri: 'https://github.com/aram10/dramaturge',
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: !result.partial,
            startTimeUtc: result.startTime.toISOString(),
            endTimeUtc: result.endTime.toISOString(),
          },
        ],
        results,
        properties: {
          'dramaturge.targetUrl': result.targetUrl,
          'dramaturge.partial': result.partial,
        },
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
