// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { BenchmarkApp } from './types.js';

/**
 * Well-known open-source applications for benchmarking Dramaturge's
 * signal-to-noise ratio and finding accuracy.
 */
export const BENCHMARK_APPS: BenchmarkApp[] = [
  {
    id: 'todomvc-react',
    name: 'TodoMVC (React)',
    url: 'https://todomvc.com/examples/react/dist/',
    description: 'Classic TodoMVC implementation in React - simple CRUD interface',
    framework: 'React',
    configPath: 'benchmarks/configs/todomvc-react.json',
    knownIssues: [
      {
        id: 'todomvc-1',
        category: 'Accessibility Issue',
        description: 'Missing ARIA labels on todo item checkboxes',
        severity: 'Minor',
      },
      {
        id: 'todomvc-2',
        category: 'UX Concern',
        description: 'No visual feedback when all items are completed',
        severity: 'Trivial',
      },
    ],
  },
  {
    id: 'todomvc-vue',
    name: 'TodoMVC (Vue)',
    url: 'https://todomvc.com/examples/vue/',
    description: 'TodoMVC implementation in Vue.js',
    framework: 'Vue',
    configPath: 'benchmarks/configs/todomvc-vue.json',
    knownIssues: [
      {
        id: 'todomvc-vue-1',
        category: 'Accessibility Issue',
        description: 'Missing keyboard navigation for todo items',
        severity: 'Minor',
      },
    ],
  },
  {
    id: 'realworld-demo',
    name: 'RealWorld Demo',
    url: 'https://demo.realworld.io/',
    description:
      'RealWorld "Conduit" app - Medium.com clone with articles, comments, tags, following',
    framework: 'Angular',
    configPath: 'benchmarks/configs/realworld-demo.json',
    knownIssues: [
      {
        id: 'realworld-1',
        category: 'Bug',
        description: 'Pagination breaks when navigating back from article detail',
        route: '/articles',
        severity: 'Major',
      },
      {
        id: 'realworld-2',
        category: 'Accessibility Issue',
        description: 'Form validation errors lack proper ARIA announcements',
        route: '/register',
        severity: 'Minor',
      },
      {
        id: 'realworld-3',
        category: 'UX Concern',
        description: 'No loading state when fetching articles',
        severity: 'Minor',
      },
    ],
  },
];

export function getBenchmarkApp(id: string): BenchmarkApp | undefined {
  return BENCHMARK_APPS.find((app) => app.id === id);
}

export function listBenchmarkApps(): BenchmarkApp[] {
  return BENCHMARK_APPS;
}
