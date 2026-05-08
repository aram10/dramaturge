// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { listBenchmarkApps } from '../benchmarks/apps.js';
import { runBenchmark, saveBenchmarkResult } from '../benchmarks/runner.js';

export interface BenchmarkCommandOptions {
  appId?: string;
  save?: boolean;
  outputDir?: string;
}

export interface BenchmarkCommandDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
}

export async function runBenchmarkCommand(
  options: BenchmarkCommandOptions,
  dependencies: BenchmarkCommandDependencies
): Promise<number> {
  const { log, error } = dependencies;

  try {
    // If no app ID specified, list available apps
    if (!options.appId) {
      log('Available benchmark applications:\n');
      const apps = listBenchmarkApps();
      for (const app of apps) {
        log(`  ${app.id.padEnd(20)} ${app.name}`);
        log(`    ${app.description}`);
        log(`    URL: ${app.url}`);
        log(`    Known issues: ${app.knownIssues?.length ?? 0}\n`);
      }
      log('Usage: dramaturge benchmark <app-id> [--save] [--output <dir>]');
      return 0;
    }

    // Run the benchmark
    log(`Running benchmark for ${options.appId}...`);
    const result = await runBenchmark(options.appId);

    // Save results if requested
    if (options.save) {
      const outputDir = options.outputDir ?? './benchmarks/results';
      saveBenchmarkResult(result, outputDir);
    }

    // Return success if precision is acceptable (>50%)
    return result.metrics.precision >= 0.5 ? 0 : 1;
  } catch (err) {
    error(`Benchmark failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
