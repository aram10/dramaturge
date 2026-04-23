# Changelog

## [0.5.0](https://github.com/aram10/dramaturge/compare/dramaturge-v0.4.0...dramaturge-v0.5.0) (2026-04-23)


### Features

* add auto-config command ([5b5f9cc](https://github.com/aram10/dramaturge/commit/5b5f9cc5f4dc8ee80c143e4b1b568cac62b36893))


### Bug Fixes

* address bootstrap safe-mode review feedback ([eb34ed5](https://github.com/aram10/dramaturge/commit/eb34ed5667d225f8c4cc634befae4799e059bc2d))
* address bootstrap safe-mode review feedback ([78416a4](https://github.com/aram10/dramaturge/commit/78416a44eb1ee21cdc96a125f3c276f9b88efaef))
* address bootstrap safe-mode review feedback ([0f89f61](https://github.com/aram10/dramaturge/commit/0f89f61e45df7ff435a86b61463d6788c837e6b2))
* address bootstrap safe-mode review feedback ([2a0a59d](https://github.com/aram10/dramaturge/commit/2a0a59df9a89b840bd6545a4429aee396dd4addc))
* address cross-run classification review feedback ([3dfb80d](https://github.com/aram10/dramaturge/commit/3dfb80d087f81481a1ff9bdd0342cad0966fc0bf))
* address PR feedback for ollama/custom provider defaults ([9835e0f](https://github.com/aram10/dramaturge/commit/9835e0f6cd46caefd821e38b17a30c21f01622ee))
* address PR review comments on auto-config ([b121289](https://github.com/aram10/dramaturge/commit/b1212890a16e0ea010da912a234c339446732ad8))
* address PR review feedback for SARIF, JUnit, and CLI format help ([412e842](https://github.com/aram10/dramaturge/commit/412e842cae43a365fd451f0acae2dc018af968d0))
* address PR review feedback for triage commands ([c56f12a](https://github.com/aram10/dramaturge/commit/c56f12a04884503c84ec0e83f88a205f7b1ffd8d))
* address setup repo-scan PR feedback ([d118ca7](https://github.com/aram10/dramaturge/commit/d118ca7c1355567b5d650e695cb8bec7fe5de149))
* address setup repo-scan PR feedback ([ccb3a4b](https://github.com/aram10/dramaturge/commit/ccb3a4bc8171df5b3bd3111d54e772af9670373b))
* address triage and baseline review feedback ([a430a9a](https://github.com/aram10/dramaturge/commit/a430a9a792552c4e71ffb9177597f87fbbd19c15))
* clarify safe-mode shell metacharacter regex ([3c08787](https://github.com/aram10/dramaturge/commit/3c08787acf3b5d42df5f8bfd66db22f64dad083f))
* polish auto-config flow ([91dbf5b](https://github.com/aram10/dramaturge/commit/91dbf5b6585ae5700c1aa844078daf1969486a27))

## [0.4.0](https://github.com/aram10/dramaturge/compare/dramaturge-v0.3.0...dramaturge-v0.4.0) (2026-04-21)


### Features

* add codecov.yml and increase test coverage for user-facing code ([d44c652](https://github.com/aram10/dramaturge/commit/d44c65265bff6005bd9687ab1a6fe408cdd03075))
* add ports/adapters LLM provider abstraction with Azure, OpenRouter, GitHub Models support ([01a17f1](https://github.com/aram10/dramaturge/commit/01a17f1888ad3f3d02d42361815683d9e70a0d6a))
* ports/adapters LLM provider abstraction with Azure Foundry, OpenRouter, GitHub Models ([014cd82](https://github.com/aram10/dramaturge/commit/014cd827e4af9e6983029a3c77164fa5d3df8ba4))


### Bug Fixes

* add defensive guard in frontier pruneLowest against out-of-bounds slice ([d96d5e9](https://github.com/aram10/dramaturge/commit/d96d5e98947b6916fab8d1347924d24ae3f2aece))
* address all review comments on provider abstraction PR ([aad9cb3](https://github.com/aram10/dramaturge/commit/aad9cb356a9e7f883722ca9d1a2cb3cdafef47f1))
* address PR review feedback on test portability, URL fallback, and types.ts ignore ([cb1b563](https://github.com/aram10/dramaturge/commit/cb1b563f8d3d39a3ddea574a9e48114e7cea0ec2))
* fix coverage workflow and configure vitest coverage ([0bd7f47](https://github.com/aram10/dramaturge/commit/0bd7f4793cb907910dc3a74370f0a8280f1c2c3a))
* format dependabot.yml and add @vitest/coverage-v8 as dev dependency ([96dd58e](https://github.com/aram10/dramaturge/commit/96dd58e66f6a6b20e3fa2f2733ee987d01eaeaa6))
* make lint CI pass and fix code coverage workflow ([1f66aad](https://github.com/aram10/dramaturge/commit/1f66aad97387f3b4eae25dca523d3b95a810588c))
* remove @codecov/vite-plugin (incompatible with vite@8), make shortId test deterministic ([1174a72](https://github.com/aram10/dramaturge/commit/1174a723aa8e01736f0b8965f999ddc569ce8770))

## [0.3.0](https://github.com/aram10/dramaturge/compare/dramaturge-v0.2.0...dramaturge-v0.3.0) (2026-04-10)


### Features

* add CLI subcommands (run, setup, doctor, init), .env support, config-less runs ([ec83451](https://github.com/aram10/dramaturge/commit/ec83451532b50ff3e02f942a4d038bcf339f3dc3))
* add CLI subcommands, .env support, and config-less runs ([b756b08](https://github.com/aram10/dramaturge/commit/b756b08c6401361b179a5037e4341c6dc6534082))
* add code quality tools and clean up anti-patterns ([32c3ac5](https://github.com/aram10/dramaturge/commit/32c3ac547bc6f3b3de51eaa39e7bff0d4c3234bc))
* add coverage and workflow status badges ([7fa74e4](https://github.com/aram10/dramaturge/commit/7fa74e4797d5d8385c04b0fadbd7ceb6f8e13bcd))
* add coverage and workflow status badges ([ca986e9](https://github.com/aram10/dramaturge/commit/ca986e904ec8f94198841b960925c87604cfef34))


### Bug Fixes

* address action review followups ([92d1544](https://github.com/aram10/dramaturge/commit/92d1544c97f5bd15c115297a3656d066dbbaa246))
* address bootstrap readiness review feedback ([e31507a](https://github.com/aram10/dramaturge/commit/e31507a950824d8e63932b4c64e14d80dd7a3cf1))
* address bootstrap review feedback ([5e10a3c](https://github.com/aram10/dramaturge/commit/5e10a3cbcd21623769bf213245f221817537c7ad))
* address coverage workflow review feedback ([c083010](https://github.com/aram10/dramaturge/commit/c08301089b4fc5edd80d5b3181b145d706523e7e))
* address high-priority code quality issues ([7e99d3c](https://github.com/aram10/dramaturge/commit/7e99d3c430543de8c4093045dd52e54100269872))
* address PR review comments and format codebase with prettier ([1a9332a](https://github.com/aram10/dramaturge/commit/1a9332a0084c76b7d037b6e4fb3482e1f51f1d60))
* address review feedback on config-inline, doctor, and test portability ([8cb41a8](https://github.com/aram10/dramaturge/commit/8cb41a87378a49198947e546b2ed9e28301b3a95))
* align temp config path with source ([e161c10](https://github.com/aram10/dramaturge/commit/e161c107edf0d78b18e232a7df4f0f4d983b693b))
* create missing config dirs in action prep ([50ad4ba](https://github.com/aram10/dramaturge/commit/50ad4ba643b7c856c147da61914ba351fb6dab51))
* improve type safety and remove console statements from production code ([1cde81b](https://github.com/aram10/dramaturge/commit/1cde81b258648e6a60e10219c983d1e7091e4a5f))
* isolate bootstrap readiness page checks ([8a98a03](https://github.com/aram10/dramaturge/commit/8a98a03b1d1bae8e929c688dfcfb2bf7564fce0c))
* make action config overrides explicit ([31c0c39](https://github.com/aram10/dramaturge/commit/31c0c393d1ba9c37b8a3c64e5e9ae0d391937f6e))
* normalize input recording policy selectors ([30bc070](https://github.com/aram10/dramaturge/commit/30bc0709a681ca1010d4142e5e6a08f1073a396f))
* override vulnerable langsmith transitive dependency ([87b05d7](https://github.com/aram10/dramaturge/commit/87b05d77b0d95f37b52b9dc5d02fab51e22dd516))
* pass bootstrap status to readiness checks ([1db64f0](https://github.com/aram10/dramaturge/commit/1db64f04fc184f8050be98304eeb1de1ed515a22))
* preserve config-relative paths in action config prep ([45d02be](https://github.com/aram10/dramaturge/commit/45d02bec854b5520d0fe6b1369a80c4e412bfe42))
* redact recorded secret form inputs ([7c810d9](https://github.com/aram10/dramaturge/commit/7c810d911f2fa43298b8cdc3d4e5dd31d53c34d6))
* replace page: any with Playwright types, extract magic numbers, improve error handling ([5c7076d](https://github.com/aram10/dramaturge/commit/5c7076d86d94fceaf6592306c594ac5b062b54d9))
* scope code conventions to exclude src/adaptation/fixtures ([fff60cb](https://github.com/aram10/dramaturge/commit/fff60cbfc8faa28d3a8a8779cf2b5b9c3aea40fe))
* scope langsmith override to vulnerable versions ([4eef251](https://github.com/aram10/dramaturge/commit/4eef251807a9f6fcc7bbb2d7f852b3753881017a))
* share jsonc parser with github action ([a76ea2e](https://github.com/aram10/dramaturge/commit/a76ea2e5ed9f1987fa3ac86f90de3257312ca4c4))
* stop bootstrap process groups on unix ([23a8765](https://github.com/aram10/dramaturge/commit/23a87650375a051373559e349c0329e47e980b02))
* tighten bootstrap shutdown fallback ([368926a](https://github.com/aram10/dramaturge/commit/368926a79f6a7dac582d6bd48ce03d595b285873))
* tighten request context guard ([057bb2f](https://github.com/aram10/dramaturge/commit/057bb2f0a983a5e89101d4c4513e4a6c626b5155))
* use optional catch binding to remove unused error variables ([f93a1e3](https://github.com/aram10/dramaturge/commit/f93a1e31f7115171347e2ee0136074959bbe14a9))

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
