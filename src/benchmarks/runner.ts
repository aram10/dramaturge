// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEngine } from '../engine.js';
import { loadConfig } from '../config.js';
import type { Finding, RawFinding } from '../types.js';
import { BENCHMARK_APPS, getBenchmarkApp } from './apps.js';
import { generateBenchmarkResult, formatMetrics } from './metrics.js';
import type { BenchmarkResult } from './types.js';

export interface BenchmarkRunOptions {
  appId?: string;
  outputDir?: string;
  saveResults?: boolean;
}

/**
 * Run a benchmark against a specific app.
 * Note: This is a simplified version for demonstration.
 * In a real benchmark, you would parse the generated report files to extract findings.
 */
export async function runBenchmark(appId: string): Promise<BenchmarkResult> {
  const app = getBenchmarkApp(appId);
  if (!app) {
    throw new Error(`Unknown benchmark app: ${appId}`);
  }

  console.log(`\n=== Running benchmark: ${app.name} ===`);
  console.log(`URL: ${app.url}`);
  console.log(`Description: ${app.description}\n`);

  const configPath = resolve(process.cwd(), app.configPath);
  const config = loadConfig(configPath);

  const startTime = Date.now();
  let firstFindingTime: number | undefined;

  // Run the engine
  await runEngine(config);

  // Read the generated report to extract findings
  // The report is written to config.output.dir
  const reportDir = config.output.dir ?? './dramaturge-reports';
  const jsonReportPath = resolve(reportDir, 'report.json');

  let findings: Finding[] = [];
  try {
    const reportContent = readFileSync(jsonReportPath, 'utf-8');
    const report: unknown = JSON.parse(reportContent);

    // Extract findings from the report
    if (report && typeof report === 'object' && 'areas' in report && Array.isArray(report.areas)) {
      findings = report.areas.flatMap((area: unknown) => {
        if (!area || typeof area !== 'object') {
          return [];
        }
        const areaObj = area as { name?: string; findings?: RawFinding[] };
        return (areaObj.findings ?? []).map((f: RawFinding) => ({
          ...f,
          id: f.ref ?? `${areaObj.name ?? 'unknown'}-${f.title}`,
          area: areaObj.name ?? 'unknown',
          occurrenceCount: 1,
          impactedAreas: [areaObj.name ?? 'unknown'],
          occurrences: [],
        }));
      });
    }

    // Try to determine first finding time from the report
    if (report && typeof report === 'object' && 'startTime' in report && findings.length > 0) {
      firstFindingTime = startTime + 10000; // Approximate
    }
  } catch (error) {
    console.warn('Could not read report file:', error);
  }

  const endTime = Date.now();

  // Generate benchmark result
  const benchmarkResult = generateBenchmarkResult(app, findings, {
    startTime,
    firstFindingTime,
    endTime,
  });

  console.log('\n=== Benchmark Results ===');
  console.log(formatMetrics(benchmarkResult.metrics));

  return benchmarkResult;
}

/**
 * Run all benchmarks.
 */
export async function runAllBenchmarks(
  options: BenchmarkRunOptions = {}
): Promise<BenchmarkResult[]> {
  const appsToRun = options.appId
    ? BENCHMARK_APPS.filter((app) => app.id === options.appId)
    : BENCHMARK_APPS;

  const results: BenchmarkResult[] = [];

  for (const app of appsToRun) {
    try {
      const result = await runBenchmark(app.id);
      results.push(result);

      if (options.saveResults) {
        const outputDir = options.outputDir ?? './benchmarks/results';
        saveBenchmarkResult(result, outputDir);
      }
    } catch (error) {
      console.error(`Failed to run benchmark for ${app.id}:`, error);
    }
  }

  return results;
}

/**
 * Save benchmark result to disk.
 */
export function saveBenchmarkResult(result: BenchmarkResult, outputDir: string): void {
  const appDir = resolve(outputDir, result.app.id);
  mkdirSync(appDir, { recursive: true });

  // Save metrics as JSON
  const metricsPath = resolve(appDir, 'metrics.json');
  writeFileSync(metricsPath, JSON.stringify(result.metrics, null, 2));

  // Save full result as JSON
  const resultPath = resolve(appDir, 'result.json');
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        app: result.app,
        metrics: result.metrics,
        findingsCount: result.rawFindings.length,
        classificationsCount: result.classifications.length,
      },
      null,
      2
    )
  );

  // Save formatted metrics as markdown
  const metricsMarkdown = formatMetrics(result.metrics);
  const markdownPath = resolve(appDir, 'metrics.md');
  writeFileSync(markdownPath, metricsMarkdown);

  console.log(`\nResults saved to ${appDir}`);
}
