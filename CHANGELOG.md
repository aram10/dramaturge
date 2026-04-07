# Changelog

## [0.2.0](https://github.com/aram10/dramaturge/compare/dramaturge-v0.1.0...dramaturge-v0.2.0) (2026-04-07)


### Features

* add A2A protocol types, agent cards, blackboard, message bus, and coordinator ([8f5b3df](https://github.com/aram10/dramaturge/commit/8f5b3df29f93c20c0e41d36aec486b01a669ad00))
* add assertion inference for HTTP responses, form validation, CRUD/list, visual diffs, API contracts, and console errors ([56ca16f](https://github.com/aram10/dramaturge/commit/56ca16fb125bc718539c70053031dcafb7989264)), closes [#7](https://github.com/aram10/dramaturge/issues/7)
* add Astro framework adapter ([5f434a1](https://github.com/aram10/dramaturge/commit/5f434a19fe9eb8c7adc3283ffac140e1292ca531))
* add diff-aware exploration mode for PR-scoped runs ([51cf2c8](https://github.com/aram10/dramaturge/commit/51cf2c8d19d6a46402849faeb7fde77e5c7fcd44))
* add Django adapter for repo-aware scanning ([4dddb45](https://github.com/aram10/dramaturge/commit/4dddb45955df608b7ab8c8f8123398470772e466))
* add Express/Fastify adapter for repo-aware scanning ([b2302f0](https://github.com/aram10/dramaturge/commit/b2302f0a0a33fb970b4d19b660746564b7ab0710))
* add FastAPI framework adapter ([dbd49df](https://github.com/aram10/dramaturge/commit/dbd49df9f87c762fe09f0ca9671e97dcc30d59cc))
* add framework adapters for SvelteKit, Nuxt, Remix, Astro, FastAPI, Rails ([abaf802](https://github.com/aram10/dramaturge/commit/abaf8027a0c3ee65ec8e99e038cd3262f720557c))
* add GPL-3.0 license, author, keywords, changelog, contributing guide, and release-please automation ([44a528e](https://github.com/aram10/dramaturge/commit/44a528eea00a61ff88c57222c64a0cf95769e9c1))
* add Nuxt 3 framework adapter ([68d679f](https://github.com/aram10/dramaturge/commit/68d679fd4925d33e3a81b64d1860cb09bb349ed9))
* add React Router v6+ adapter for repo-aware scanning ([6afb4e3](https://github.com/aram10/dramaturge/commit/6afb4e31dbb99fcab0014ef21cea2f9e33516cb1))
* add real-time terminal dashboard with ink ([5b1b0e6](https://github.com/aram10/dramaturge/commit/5b1b0e648ba5a9ad760823475cc6324eb35eefa0))
* add Remix framework adapter ([b833a2f](https://github.com/aram10/dramaturge/commit/b833a2f80b6274d0749fc693fa76316ec2618361))
* add streaming/progressive output with typed event emitter ([36c8c72](https://github.com/aram10/dramaturge/commit/36c8c729a5008bb286f536bef7c1d549811e02cf))
* add SvelteKit framework adapter ([28b07fc](https://github.com/aram10/dramaturge/commit/28b07fc71a1b810c7ac6ecb9ae0daded605c0670))
* add vision-based page understanding (hybrid DOM + screenshot) ([17b8090](https://github.com/aram10/dramaturge/commit/17b8090823af7fae6f544f2464b70ca2ee9a6504))
* add Vue Router adapter for repo-aware scanning ([d74ffac](https://github.com/aram10/dramaturge/commit/d74ffac231d1daea048e295441ad458c0db8d449))
* integrate A2A multi-agent orchestration with terminal dashboard ([ce8b989](https://github.com/aram10/dramaturge/commit/ce8b9899174525ef3259433d219320f0b1350d38))
* Multi-agent orchestration with A2A protocol and dashboard integration ([20153e4](https://github.com/aram10/dramaturge/commit/20153e4a52628b3c8bd0cd399356f84f0a23b49b))
* real-time streaming terminal dashboard via Ink ([b7fa5a1](https://github.com/aram10/dramaturge/commit/b7fa5a1b7b93b74a0ed178cb373962c857e2fa48))
* vision-based page understanding (hybrid DOM + screenshot) ([3eca095](https://github.com/aram10/dramaturge/commit/3eca095cba5e1af627d6eff29a714a72852032cf))
* add appContext config section for false positive reduction ([a68a550](https://github.com/aram10/dramaturge/commit/a68a55068f853229b6d630c971932a261b0bcca0))
* add BlindSpot tracking to CoverageTracker ([682ffe4](https://github.com/aram10/dramaturge/commit/682ffe48c0a124de9ab3eb1c102e63fd64bb9f53))
* add link extraction utility for multi-pass navigation discovery ([46eb02e](https://github.com/aram10/dramaturge/commit/46eb02e3cf516e6345e5b9c3232163dcfb4ee997))
* add page stability detector for SPA handling ([888e73b](https://github.com/aram10/dramaturge/commit/888e73bd7b9ed7352f04f9b8b5d205e751a71a34))
* add repo-aware hints and optional environment bootstrap ([d0088b5](https://github.com/aram10/dramaturge/commit/d0088b58d2a37dc2df8ceef67cbf0e0b320b50c0))
* add request_followup and report_discovered_edge tools, add executeWorkerTask ([0facd47](https://github.com/aram10/dramaturge/commit/0facd47f8157a95ab4fff4e298a004ca57ac1f0e))
* add StagnationTracker utility for early worker termination ([27531fe](https://github.com/aram10/dramaturge/commit/27531fe7b9932bf6dc3cb7e456253ee7253f4f34))
* add v2 domain types — state graph, frontier, worker task/result, mission, budget ([0598d33](https://github.com/aram10/dramaturge/commit/0598d33b87d8f16193fcc049c6a93d5193ad2cd9))
* attach repro artifacts and confidence to findings ([c191b35](https://github.com/aram10/dramaturge/commit/c191b3505c2a3739731f13a9bd24a0af8c07dcdd))
* enforce mission controls and suppress expected environment noise ([5364591](https://github.com/aram10/dramaturge/commit/5364591d321fdd2344b8c17b6557bf289e959234))
* extend config — mission, budget, per-worker-type models ([ba33a61](https://github.com/aram10/dramaturge/commit/ba33a613e406ad9e038531dcb73b143ec702603e))
* implement planner layer — priority scoring, navigator, planner ([fcda4e9](https://github.com/aram10/dramaturge/commit/fcda4e917e3b92dbe92ded6c3753afaea8424741))
* implement StateGraph and FrontierQueue ([ae87ac6](https://github.com/aram10/dramaturge/commit/ae87ac63648c6c331b69a5a14f11da412c31c8ec))
* implement Tier 2 missing core capabilities ([5a99ac1](https://github.com/aram10/dramaturge/commit/5a99ac11cfdb5940099ce70f54b9e1a3a561d360))
* implement v1.5 upgrades ([9f63e56](https://github.com/aram10/dramaturge/commit/9f63e56629f9304059dce3ef15d4bb8c77ebfba1))
* implement v2 engine — planner-managed frontier loop with state graph ([30149ad](https://github.com/aram10/dramaturge/commit/30149ad8c90ba9f89cccfdcbdfd6a06cd4f6cb82))
* inject structured appContext into worker prompts to reduce false positives ([0cb4f2e](https://github.com/aram10/dramaturge/commit/0cb4f2ea02bc1069d26760c6b7d649d1d198738c))
* multi-pass navigation discovery (observe + link extraction) ([c77be92](https://github.com/aram10/dramaturge/commit/c77be92145170aa67932ab6a96ec1c11457e16c8))
* per-worker-type agent mode overrides (navigation+form default to dom) ([fde4e36](https://github.com/aram10/dramaturge/commit/fde4e36441f296c09081807d14390ac1a49a51a9))
* preserve query-aware state identity and resolve edges from source state ([26982ea](https://github.com/aram10/dramaturge/commit/26982ea9df13591e81be5b53c49d540c3909b68c))
* wait for page stability after navigation before fingerprinting/exploration ([7846a5b](https://github.com/aram10/dramaturge/commit/7846a5b55ec2cf9ba0affb3ec1ac887500162206))
* wire CLI to v2 engine (--legacy flag for old runner), update example config ([b07e631](https://github.com/aram10/dramaturge/commit/b07e6312f3ade957a2d78c453a1a6eecaebc652c))
* wire stagnation detection into worker execution loop ([91031e2](https://github.com/aram10/dramaturge/commit/91031e2337a408ef798fe1d495c76cfaa4671f69))


### Bug Fixes

* add nuxt to config framework enum for consistency ([e605661](https://github.com/aram10/dramaturge/commit/e605661ba21fba7c17398b90174f2dad9f8106cb))
* address 6 PR review comments on assertion inference ([f3cad4a](https://github.com/aram10/dramaturge/commit/f3cad4ae65d97fd7d577385d590b783bf0d00108))
* address code review — track messagesSent, remove unused coordinator prop ([a94e01f](https://github.com/aram10/dramaturge/commit/a94e01fe8342afb871340bde915a7c71e1608588))
* address PR review feedback for diff-aware exploration ([3cc4821](https://github.com/aram10/dramaturge/commit/3cc4821fd1b6b69926d6e100bab37ff059c3c031))
* address PR review feedback for new framework adapters ([efb040b](https://github.com/aram10/dramaturge/commit/efb040bf1a6652c62399e8fcea53ea7b87df0a7b))
* address PR review feedback on event stream ([5ba3a7f](https://github.com/aram10/dramaturge/commit/5ba3a7f79ea6b2a0d266b8d908ee7cdd40182591))
* address review feedback on dashboard ([3c43f17](https://github.com/aram10/dramaturge/commit/3c43f174d4b3164c9cb052c856582202984b8ab9))
* guard publish workflow against pre-releases and non-release-please tags ([6ab68c7](https://github.com/aram10/dramaturge/commit/6ab68c73ae80e69c72dba4278923f93626611176))
* place preamble listeners before page.goto to capture load-time events ([c0f9702](https://github.com/aram10/dramaturge/commit/c0f97023360aa9e09895e9c80ffa309d3a14bea4))
* remove duplicate canScanNextJsRepo call and sort imports in repo-scan.ts ([39aea4d](https://github.com/aram10/dramaturge/commit/39aea4df820b9619ec2f8b172332a3de4e7ea4b9))
* resolve merge conflicts and address PR review feedback ([7faa21d](https://github.com/aram10/dramaturge/commit/7faa21d874b27605244152c95695268bafc25aa7))
* use American English spelling in A2A module documentation ([0cb9338](https://github.com/aram10/dramaturge/commit/0cb93387b6e8c24211ce9be49c4004fd96db668c))
* use structuredClone for deep immutability of blackboard data ([f67451b](https://github.com/aram10/dramaturge/commit/f67451b65636d58f3838f976bf67849ac608b538))
* parse jsonc config without corrupting urls ([841b26c](https://github.com/aram10/dramaturge/commit/841b26c63d4435be2b2dd5924e7fb7afc30e5f58))
* require explicit auth success indicator semantics ([6428453](https://github.com/aram10/dramaturge/commit/642845382250a6e6234aa85f637e54fc73fb0c23))
* unify parallel execution options and isolate browser errors per page ([e94e264](https://github.com/aram10/dramaturge/commit/e94e264e02541ee6f77d7fc732f092412a7bbe63))

## Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed automatically by
[release-please](https://github.com/googleapis/release-please). To trigger a
release, merge commits that follow the
[Conventional Commits](https://www.conventionalcommits.org/) specification into
`main`.
