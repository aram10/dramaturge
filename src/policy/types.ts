export interface ExpectedResponseRule {
  method?: string;
  pathPrefix: string;
  statuses: number[];
}

export interface PolicyConfig {
  expectedResponses: ExpectedResponseRule[];
  ignoredConsolePatterns: string[];
}
