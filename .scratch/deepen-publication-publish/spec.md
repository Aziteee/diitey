# Deepen publication: one Theme IA publish path

Status: ready-for-agent

## Problem Statement

Understanding how a content file becomes a served URL requires bouncing across Content Snapshot, Page Plan, Effective Publication, Site Program, and the Publication Runtime. Theme path matching runs twice independently (canonical URLs and page publish). Routing helpers live under Content Snapshot even though they are Theme information architecture. The snapshot worker recompiles a full Site Program—including Island bundling—for content-only reload. Page Plan is deep but only exercised through full-process e2e. Maintainers and agents cannot change routing or publish behavior with locality, and most bugs cannot be caught at the domain interface.

## Solution

Deepen publication so that Theme IA path work and “Content Snapshot under Site Program → routes” live behind a small set of seams:

1. A pure **route-pattern** module owns match/build/normalize and collection matchers (Theme IA primitives).
2. A single **publishRoutes** path produces a Publication Candidate (one Theme IA walk, not two).
3. **materializePublication** remains the only step that turns a candidate into an Effective Publication (maps, island assets from the pinned Site Program, revision checks).
4. Page Plan keeps its deep external interface (`publish` / `render`) but exposes pure internal stages for unit tests.
5. The snapshot worker becomes a transport adapter over a publish-capable program payload—not a second full Site Program compile that rebuilds Islands.

Reload still pins the startup Site Program (no Theme/Plugin/Island hot-reload). Atomic Effective Publication swap is unchanged.

## User Stories

1. As a core maintainer, I want Theme path matching and route building in one module, so that I do not open Content Snapshot to understand URLs.
2. As a core maintainer, I want Content Snapshot to own scanning, parsing, indexing, and Content Records only, so that module names match domain ownership.
3. As a core maintainer, I want collection matchers compiled next to route patterns, so that Theme IA compile has locality.
4. As a core maintainer, I want Page Plan to import route-pattern helpers rather than Content Snapshot, so that dependencies reflect Theme IA, not historical file placement.
5. As a core maintainer, I want Site Program compile to import route-pattern for item route specs and matchers, so that program formation has a clear Theme IA dependency.
6. As a core maintainer, I want a single publishRoutes(program, content) path, so that item URLs and PublishedRouteEntry production share one Theme IA walk.
7. As a core maintainer, I want canonical URLs and published routes to agree by construction, so that dual independent match walks cannot drift.
8. As a core maintainer, I want materializePublication to remain the only Effective Publication assembler, so that route maps, content ID sets, and island asset maps stay in one place.
9. As a core maintainer, I want startup and reload to share the same domain publish function, so that I do not maintain buildEffectivePublication and buildPublicationCandidate as parallel loops.
10. As a core maintainer, I want freeze/clone for worker transfer at the transport adapter, so that domain materialize does not re-implement worker bookkeeping.
11. As a site operator, I want content reload to keep using the pinned Site Program, so that Theme, Plugin, and Island versions never mix mid-process.
12. As a site operator, I want a failed reload to leave the previous Effective Publication in place, so that the site stays consistent.
13. As a site operator, I want reload not to rebuild Islands, so that content refresh cost and failure modes match content work only.
14. As a core maintainer, I want the snapshot worker to receive a publish-capable program payload, so that worker init does not re-run Island bundling or full page import when only content changed.
15. As a core maintainer, I want main and worker to agree on programRevision, so that a mismatched program cannot materialize.
16. As a core maintainer, I want worker timeout or crash to keep the current Effective Publication and mark reload unavailable as today, so that isolation guarantees remain.
17. As a core maintainer, I want Page Plan’s external interface to stay small (publish / render), so that callers keep one deep seam.
18. As a core maintainer, I want pure internal Page Plan stages (bindings, publish entries, render entry), so that binding and pagination bugs can be tested without spawning a process.
19. As a core maintainer, I want to construct a Page Plan from in-memory Theme definitions without Island build, so that unit tests do not depend on disk fixtures for pure logic.
20. As a core maintainer, I want SSR plugin service invocation and Action invocation to share timeout/invoke depth where appropriate, so that timeout policy has one owner.
21. As a core maintainer, I want Action HTTP policy (Origin, CSRF, body limit, rate limit) to remain in the Publication Runtime, so that backend-only Plugin rules stay at the Action entry.
22. As a core maintainer, I want unit tests for route-pattern edge cases, so that match/build regressions fail without a Site fixture.
23. As a core maintainer, I want unit tests for publishRoutes, so that “content under Site Program → routes” is proven at the domain interface.
24. As a core maintainer, I want integration tests that open publication in-process, so that Effective Publication behavior is covered without CLI spawn when process isolation is irrelevant.
25. As a core maintainer, I want process-spawn e2e only for isolation invariants (worker timeout, reload unavailability, concurrent request pinning), so that harness cost stays proportional to process concerns.
26. As an agent implementing this work, I want module ownership described in domain terms (Site Program, Content Snapshot, Effective Publication, Theme, reload), so that I do not invent parallel vocabulary.
27. As an agent implementing this work, I want ADRs 0002, 0004, and 0009 respected without reopening them, so that deepenings stay inside settled decisions.
28. As a core maintainer, I want no second Theme re-read from disk on content reload, so that “pinned Site Program” remains true after worker payload changes.
29. As a core maintainer, I want deleting the old dual match walk to concentrate complexity into publishRoutes, so that the deletion test passes for the new module.
30. As a core maintainer, I want Content Snapshot freezes to avoid redundant double-freeze ceremonies where domain and worker both freeze the same graph without reason, so that immutability has one clear owner per path.
31. As a Theme author, I want routing behavior unchanged from my perspective, so that existing Themes and Collections keep working.
32. As a Plugin author, I want Action and service contracts unchanged, so that Plugins need no migration for this refactor.
33. As a site operator, I want start / reload / status CLI behavior unchanged, so that operations stay the same.
34. As a core maintainer, I want define* identity helpers left alone, so that this effort does not expand into public authoring sugar.
35. As a core maintainer, I want Extension Config and plugin migrations untouched, so that this effort stays inside publication publish architecture.

## Implementation Decisions

### Scope and phasing

- Deliver in order: (1) route-pattern extract, (2) single publishRoutes walk, (3) unify candidate/effective entry points, (4) worker publish-capable payload (no Island rebuild), (5) Page Plan internal stages + unit seam, (6) optional shared plugin invoke/timeout helper, (7) rebalance tests toward the new seams.
- Each phase should leave the suite green; prefer replace-don’t-layer at call sites.

### Domain and ADR constraints

- Use CONTEXT.md terms: Site Program, Content Snapshot, Effective Publication, Content Record, Theme, Collection, Island, Plugin, Action, reload, Publication Runtime.
- ADR-0002: Theme owns information architecture; route-pattern is Theme IA compile, not content ownership.
- ADR-0004: requests only see a complete Effective Publication; failed reload does not swap.
- ADR-0009: content reload uses the startup-pinned Site Program; Theme/Plugin/Island changes require process restart; main and worker agree on programRevision.
- ADR-0003: Action HTTP policy stays in Publication Runtime; Plugins remain backend-only.
- Do not reopen ADR-0010 (Extension Config) or migration ADRs.

### Route-pattern module

- New deep-enough pure module for Theme routing primitives: match path pattern, build route path, normalize route path, compile collection matchers, item route specs used by program compile, and route-pattern validation currently coupled to those helpers.
- Content Snapshot stops exporting Theme routing primitives; it may import route-pattern for canonical URL assignment until publishRoutes owns that assignment entirely.
- Page Plan and Site Program import route-pattern instead of Content Snapshot for path helpers.

### publishRoutes as primary domain seam

- One function owns producing routes (and any intermediate resolved item URLs) from Site Program + Content Snapshot.
- Canonical URL assignment and PublishedRouteEntry production must not run two independent Theme path-match walks; share one pass or a shared intermediate “resolved item routes” structure.
- Startup and reload both use this function; Publication Runtime stays coordinator (handle / reload / status / close).

### Effective Publication assembly

- materializePublication remains responsible for: programRevision check, duplicate URL detection, plansById, contentIds set, island assets/manifest from Site Program, freezing the Effective Publication surface.
- Prefer a single domain path: publishRoutes → Publication Candidate → materializePublication.
- Retire parallel “same publish loop, different freeze” entry points once publishRoutes exists; worker differs at transport (clone/freeze for postMessage), not by a second domain algorithm.

### Snapshot worker

- Worker must not need full Island bundling for content-only builds.
- Introduce a publish-capable program payload (matchers, item route specs, Markdown-related inputs needed for Content Snapshot, pure publish capability) transferable or reconstructible without rebuildThemeIslands.
- Main process remains owner of Islands, page component closures, and full Site Program used for request render.
- Keep programRevision pinning and unavailable-after-timeout behavior.
- Do not re-read Theme/Plugin from disk to form a new program on reload.

### Page Plan

- Keep external CompiledPagePlan interface: publish and render.
- Structure implementation into pure stages suitable for unit tests (e.g. compile bindings → publish entries → render entry), without forcing callers to learn the stages.
- Allow constructing a plan for tests from in-memory Theme definitions without requiring Island build or full site root.
- Do not fold Page Plan into Runtime or Site Program.

### Plugin invoke (later phase, optional within this effort)

- Prefer one shared timeout/invoke helper used by Action path and SSR service resolution.
- Action-only policy (Origin, CSRF, body size, rate limit, status mapping) stays in Runtime as adapter over invoke.
- Do not move Action HTTP surface into the Plugin flatten module.

### Naming and modules

- Prefer domain names over historical file names when extracting (route-pattern / Theme IA compile, not “snapshot helpers”).
- Avoid new shallow pass-through modules; apply the deletion test before adding a file.

### Public and operational surface

- No intentional change to Theme authoring API, Plugin authoring API, CLI start/reload/status, or site.config Extension Config.
- define* helpers are out of this change.

## Testing Decisions

### What makes a good test

- Assert observable behavior at the highest appropriate seam: outputs of route-pattern, publishRoutes, materializePublication, Page Plan publish/render, and Publication Runtime isolation invariants.
- Do not assert private function names, file layout, or intermediate freeze calls.
- Prefer pure inputs (in-memory Theme definitions, Content Records, Site Program fixtures) over writing Theme/Plugin source strings and spawning CLI when the behavior under test is not process isolation.

### Primary seams under test

1. **Route-pattern** — pure unit tests: match, build, normalize, collection matchers, ambiguity/validation errors.
2. **publishRoutes** — unit/integration with a constructed Site Program + Content Snapshot: route set, parameters, agreement of item URLs used for links and routes, duplicate/conflict errors that belong at publish time.
3. **materializePublication** — revision mismatch, duplicate URLs, unknown plan id, island asset map presence from program.
4. **Page Plan stages / compile** — bindings validation, pagination, service resolution order, static vs request-time body behavior, without full process spawn when Islands are irrelevant.
5. **Worker / Runtime (e2e or focused integration)** — programRevision agreement, failed build keeps previous Effective Publication, worker timeout marks reload unavailable, request-captured content IDs for Actions across concurrent reload (existing invariants).

### Prior art in this repo

- `test/rate-limit.test.ts` — true unit test of a pure module; model new unit tests after this style.
- `test/publication-invariants.test.ts`, `test/reliable-reload.test.ts` — process-level isolation and reload guarantees; keep for process concerns, do not use as the only way to test routing.
- `test/content-routing.test.ts`, `test/minimal-publishing.test.ts`, `test/dynamic-behavior.test.ts` — full fixture + spawn; migrate routing/pagination cases down to publishRoutes / Page Plan seams over time; leave spawn where isolation is the point.

### Regression bar

- Existing e2e suite remains green after each phase.
- New unit coverage for route-pattern and publishRoutes is required before declaring the dual-walk collapse done.
- Worker payload phase must prove Islands are not rebuilt on the reload path (behavior or structural test at the worker seam).

## Out of Scope

- Hot-reloading Theme, Plugin, Island, or site.config without process restart.
- Changing Plugin migration timing or schema ownership.
- Moving Extension Config into data/ or runtime settings.
- Frontend/Plugin-owned pages or Plugin-owned Islands.
- Deepening or redesigning defineSite / defineTheme / definePlugin / collection / page / route sugar.
- Multi-process or remote deployment model changes.
- Redesigning Action CSRF/Origin policy beyond sharing invoke/timeout helpers.
- Performance optimization as a primary goal (correct locality first; worker avoiding Island rebuild is in scope because it is architectural, not a micro-opt).
- Large test harness rewrite in one shot without the domain seams landing first.

## Further Notes

- Origin of this work: architecture review of publication hot spots after the pinned Site Program deepen (`cde58bc` and related). Report path was OS temp `architecture-review-*.html`; top recommendation was extract route-pattern then collapse dual publish walks.
- Vocabulary for implementers: module, interface, implementation, depth, seam, adapter, leverage, locality — do not substitute “service/API/boundary” for those terms in design notes.
- If worker payload transfer requires a durable decision beyond ADR-0009 (e.g. explicit serializable publish program type), record an ADR only when the shape is settled; do not invent an ADR for pure file moves.
- Suggested feature slug for tickets under this effort: `deepen-publication-publish`. Implementation issues should be one file per phase under `.scratch/deepen-publication-publish/issues/` when broken down for agents.
