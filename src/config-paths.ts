import { resolve } from "node:path";
import type { DramaturgeConfig } from "./config.js";

export interface ConfigFileContext {
  configPath: string;
  configDir: string;
}

export interface LoadedConfigMeta {
  configPath: string;
  configDir: string;
}

export type ConfigWithMeta<T> = T & {
  _meta: LoadedConfigMeta;
};

export function getConfigFileContext(configPath?: string): ConfigFileContext {
  const resolvedConfigPath = resolve(configPath ?? "dramaturge.config.json");
  return {
    configPath: resolvedConfigPath,
    configDir: resolve(resolvedConfigPath, ".."),
  };
}

function resolveFromConfigDir(configDir: string, candidate: string): string {
  return resolve(configDir, candidate);
}

export function normalizeConfigPaths(
  config: DramaturgeConfig,
  context: ConfigFileContext
): ConfigWithMeta<DramaturgeConfig> {
  const auth =
    config.auth.type === "interactive" || config.auth.type === "stored-state"
      ? {
          ...config.auth,
          stateFile: resolveFromConfigDir(context.configDir, config.auth.stateFile),
        }
      : config.auth;

  const normalizedRepoContext = config.repoContext
    ? (() => {
        const repoRoot = resolveFromConfigDir(
          context.configDir,
          config.repoContext.root ?? "."
        );

        return {
          ...config.repoContext,
          root: repoRoot,
          hintsFile: config.repoContext.hintsFile
            ? resolve(repoRoot, config.repoContext.hintsFile)
            : undefined,
          specFile: config.repoContext.specFile
            ? resolve(repoRoot, config.repoContext.specFile)
            : undefined,
        };
      })()
    : undefined;

  return {
    ...config,
    auth,
    output: {
      ...config.output,
      dir: resolveFromConfigDir(context.configDir, config.output.dir),
    },
    memory: {
      ...config.memory,
      dir: resolveFromConfigDir(context.configDir, config.memory.dir),
    },
    visualRegression: {
      ...config.visualRegression,
      baselineDir: resolveFromConfigDir(
        context.configDir,
        config.visualRegression.baselineDir
      ),
    },
    repoContext: normalizedRepoContext,
    bootstrap: config.bootstrap
      ? {
          ...config.bootstrap,
          cwd: config.bootstrap.cwd
            ? resolveFromConfigDir(context.configDir, config.bootstrap.cwd)
            : undefined,
        }
      : undefined,
    _meta: {
      configPath: context.configPath,
      configDir: context.configDir,
    },
  };
}

export function resolveResumeDir(
  resumeDir: string | undefined,
  config: Partial<ConfigWithMeta<unknown>>
): string | undefined {
  if (!resumeDir) return undefined;
  if (!config._meta?.configDir) return resumeDir;
  return resolve(config._meta.configDir, resumeDir);
}
