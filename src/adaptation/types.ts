export type RepoFramework = "auto" | "nextjs" | "generic";

export interface ExpectedHttpNoise {
  method?: string;
  pathPrefix: string;
  statuses: number[];
}

export interface RepoHints {
  routes: string[];
  stableSelectors: string[];
  authHints: {
    loginRoutes: string[];
    callbackRoutes: string[];
  };
  expectedHttpNoise: ExpectedHttpNoise[];
}

export interface RepoScanOptions {
  root: string;
  framework: RepoFramework;
  hintsFile?: string;
}

export interface RepoHintsOverride {
  routes?: string[];
  stableSelectors?: string[];
  authHints?: Partial<RepoHints["authHints"]>;
  expectedHttpNoise?: ExpectedHttpNoise[];
}
