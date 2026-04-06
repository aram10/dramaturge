export type RepoFramework =
  | "auto"
  | "nextjs"
  | "nuxt"
  | "sveltekit"
  | "react-router"
  | "express"
  | "vue-router"
  | "django"
  | "tanstack-router"
  | "generic";

export interface ExpectedHttpNoise {
  method?: string;
  pathPrefix: string;
  statuses: number[];
}

export interface ApiEndpointHint {
  route: string;
  methods: string[];
  statuses: number[];
  authRequired?: boolean;
  validationSchemas?: string[];
}

export interface RepoHints {
  routes: string[];
  routeFamilies: string[];
  stableSelectors: string[];
  apiEndpoints: ApiEndpointHint[];
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
  routeFamilies?: string[];
  stableSelectors?: string[];
  apiEndpoints?: ApiEndpointHint[];
  authHints?: Partial<RepoHints["authHints"]>;
  expectedHttpNoise?: ExpectedHttpNoise[];
}
