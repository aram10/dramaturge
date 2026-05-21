// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

declare module 'yargs' {
  interface DramaturgeYargsParseResult {
    _: unknown[];
    config?: string;
    resume?: string;
    diff?: string;
    dashboard?: boolean;
    login?: boolean;
    headless?: boolean;
    provider?: string;
    preset?: string;
    focus?: string[];
    format?: string;
    profile?: string;
    template?: string;
    url?: string;
    output?: string;
    repo?: string;
    noScan?: boolean;
    suppressed?: boolean;
    all?: boolean;
    reason?: string;
    save?: boolean;
    fromReport?: string;
    finding?: string;
  }

  interface DramaturgeYargsInstance {
    exitProcess(enabled: boolean): DramaturgeYargsInstance;
    help(enabled: boolean): DramaturgeYargsInstance;
    version(enabled: boolean): DramaturgeYargsInstance;
    strictOptions(): DramaturgeYargsInstance;
    parserConfiguration(configuration: Record<string, unknown>): DramaturgeYargsInstance;
    fail(handler: (message: string, error?: Error) => void): DramaturgeYargsInstance;
    option(name: string, configuration: Record<string, unknown>): DramaturgeYargsInstance;
    parseSync(): DramaturgeYargsParseResult;
  }

  export default function yargs(args: readonly string[]): DramaturgeYargsInstance;
}
