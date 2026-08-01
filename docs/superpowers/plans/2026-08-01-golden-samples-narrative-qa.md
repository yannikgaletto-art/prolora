# Golden Samples, Facts Timeline and Narrative QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the twelve curated Golden Samples into safe style context and require language-, fact-, mention-, freshness-, and narrative-aware QA before AI-generated content can be approved or published.

**Architecture:** Extend the existing Content DNA, Proof Vault, Writer policy, content-item, review-bundle, and post-item models additively. A shared generation-context resolver supplies masked samples, confirmed facts, history, language, and a structured Pathly decision; the existing quality gate remains the only gate and stores a hash-bound QA snapshot. Manual flows use an explicit preflight while background Writer runs use the persisted policy.

**Tech Stack:** Next.js 15 App Router, TypeScript strict mode, Supabase/PostgreSQL migrations and RPCs, Zod, Vitest, existing Anthropic tool-call wrapper.

---

### Task 1: Curated bundle parsing, masking, hashing, and retrieval

**Files:**
- Create: `apps/web/lib/writer/golden-bundle.ts`
- Modify: `apps/web/lib/writer/types.ts`
- Modify: `apps/web/lib/writer/hash.ts`
- Modify: `apps/web/lib/writer/dna.ts`
- Modify: `apps/web/lib/writer/samples.ts`
- Create: `apps/web/test/golden-sample-bundle.test.ts`
- Create: `apps/web/test/golden-sample-retrieval.test.ts`
- Track: `golden-samples/*.md`

- [ ] Write failing tests proving the four files parse into exactly twelve stable samples, masks remove numbers/placeholders/URLs/product facts, metadata affects `sample_set_hash`, avoid samples become negative rules, and retrieval returns at most two diverse platform/category matches.
- [ ] Run `npx vitest run test/golden-sample-bundle.test.ts test/golden-sample-retrieval.test.ts` from `apps/web`; expect failures for missing exports.
- [ ] Add `GoldenSampleMetadata`, `masked_content`, category/hook/format/bundle metadata, deterministic masking, bundle parsing, metadata fallback ranking, and hash inputs.
- [ ] Update DNA analysis with German/English first-person, CTA, opening, list/thread, paragraph, and avoid-pattern signals while retaining neutral low-confidence fallback.
- [ ] Run the two tests and existing `writer-dna.test.ts`; expect all green.
- [ ] Commit `feat(writer): add safe golden sample bundle pipeline`.

### Task 2: Additive repository-only schema

**Files:**
- Create: `supabase/migrations/023_golden_samples_narrative_qa.sql`
- Create: `apps/web/test/golden-narrative-schema.test.ts`
- Modify: `apps/web/lib/db.ts` only where no current branch overlap exists

- [ ] Write a failing schema-contract test for sample metadata/masking, structured fact fields, fact suggestions, content language/group, QA context, output language/mention policy, unique active fact, immutable confirmed-fact deletion guard, and workspace-scoped atomic RPCs.
- [ ] Run the schema test; expect failure because migration 023 is absent.
- [ ] Add columns, constraints, indexes, RLS-compatible structures, `confirm_fact_suggestion_atomic`, `upsert_confirmed_fact_atomic`, sample-bundle import RPC, and updated writer-policy RPC. Preserve prior migration history and mark the migration repository-only.
- [ ] Extend local row types and explicit allowlists without `select('*')` on sensitive tables.
- [ ] Run schema-contract, schema-drift, writer-policy, writer-DNA, and proof-consent tests; expect green.
- [ ] Commit `feat(db): add narrative QA and facts timeline schema`.

### Task 3: Facts and Timeline domain

**Files:**
- Create: `apps/web/lib/product/facts.ts`
- Modify: `apps/web/lib/product/profile.ts`
- Modify: `apps/web/lib/feedback/proof-extraction.ts`
- Modify: `apps/web/app/api/v1/product/proof-assets/route.ts`
- Modify: `apps/web/app/api/v1/product/proof-assets/[id]/route.ts`
- Modify: `apps/web/app/api/v1/product/proof-suggestions/[id]/route.ts`
- Create: `apps/web/test/facts-timeline.test.ts`
- Create: `apps/web/test/facts-routes.test.ts`

- [ ] Write failing tests for active/historical resolution at `as_of`, superseding, direction-policy breaks requiring a reason, unconfirmed suggestions never binding claims, confirmed structured facts not being deletable, and workspace-scoped explicit-column queries.
- [ ] Run focused tests; verify expected behavior failures.
- [ ] Implement typed fact normalization/resolution, atomic confirmation calls, paginated active/history listing, and route validation/authorization for owner/admin sessions.
- [ ] Preserve ordinary Proof Asset CRUD and consent semantics.
- [ ] Run focused and existing product/proof extraction tests; expect green.
- [ ] Commit `feat(product): add confirmed facts timeline`.

### Task 4: Shared generation context and Pathly decision

**Files:**
- Create: `apps/web/lib/generation/types.ts`
- Create: `apps/web/lib/generation/mention.ts`
- Create: `apps/web/lib/generation/context.ts`
- Modify: `apps/web/lib/writer/policy.ts`
- Create: `apps/web/test/generation-context.test.ts`
- Create: `apps/web/test/product-mention.test.ts`

- [ ] Write failing tests for explicit `de`/`en`, two contexts for `both`, max-two masked samples, confirmed facts only, deterministic fallback retrieval, adaptive/include/exclude mention decisions, Reddit unknown-rules omission, and cadence-aware decisions.
- [ ] Run focused tests and verify missing-module failures.
- [ ] Implement `GenerationContextResolver`, hashable facts/sample snapshots, canonical published-history loading, and structured mention decisions with reason/confidence/rule IDs.
- [ ] Extend background policy with `outputLanguages` and `productMentionMode`, defaulting to `['de']` and `adaptive`.
- [ ] Run focused and writer-policy tests; expect green.
- [ ] Commit `feat(generation): resolve grounded multilingual context`.

### Task 5: Narrative checks in the existing quality gate

**Files:**
- Modify: `apps/web/lib/pipeline/quality-gate.ts`
- Create: `apps/web/lib/pipeline/narrative-judge.ts`
- Create: `apps/web/lib/pipeline/qa-snapshot.ts`
- Create: `apps/web/test/narrative-quality-gate.test.ts`
- Create: `apps/web/test/qa-freshness.test.ts`

- [ ] Write failing tests for language mismatch, `[X]`, unbound metrics/currencies/durations/status claims, temporal validity, current-vs-historical wording, mention mismatch, verbatim/N-gram sample copying, skipped semantic checks not passing, structured LLM findings, and stale content/fact/sample/gate hashes.
- [ ] Run focused tests and verify behavior failures.
- [ ] Extend `GateCheck`, `GateRemedy`, `GateResult`, and `runQualityGate()` inputs without creating a second gate; implement deterministic bindings and snapshot hashing.
- [ ] Implement a tool-schema semantic judge that can report findings but cannot confirm facts; cap repair remedies at three through the existing Writer loop.
- [ ] Run focused and all existing quality-gate tests; expect green.
- [ ] Commit `feat(qa): enforce narrative and freshness checks`.

### Task 6: Writer language siblings, review snapshots, and materialization

**Files:**
- Modify: `apps/web/lib/writer/run.ts`
- Modify: `apps/web/lib/writer/reviews.ts`
- Modify: `apps/web/lib/writer/materialize.ts`
- Modify: `apps/web/lib/pipeline/channel-native.ts`
- Modify: `apps/web/lib/content/concept-service.ts`
- Modify: `apps/web/app/api/v1/writer/run/route.ts`
- Create: `apps/web/test/writer-language-groups.test.ts`
- Create: `apps/web/test/writer-narrative-review.test.ts`

- [ ] Write failing tests that `both` creates separate `de` and `en` content items per channel under one generation group, each platform is independently generated, review snapshots bind context hashes and mention decision, edits/fact changes invalidate approval, and materialization copies `qa_context`.
- [ ] Run focused tests and verify failures.
- [ ] Thread generation context through concept/channel generation, existing repair loop, immutable review bundles, and atomic post materialization.
- [ ] Keep one variant per content item/channel and adjust idempotency to signal-plus-language.
- [ ] Run Writer, review, materialization, and pipeline tests; expect green.
- [ ] Commit `feat(writer): generate grounded language siblings`.

### Task 7: Publish-path freshness enforcement

**Files:**
- Modify: `apps/web/lib/pipeline/orchestrator.ts`
- Modify: `apps/web/app/api/v1/posts/route.ts`
- Modify: `apps/web/app/api/v1/posts/bulk/route.ts`
- Modify: `apps/web/app/api/v1/posts/[id]/schedule/route.ts`
- Modify: the existing publisher immediately before external adapter calls
- Create: `apps/web/test/ai-post-qa-freshness.test.ts`

- [ ] Write failing tests that every AI-origin create/schedule/publish/bulk path rejects missing, failed, or stale QA context while manual posts remain compatible; external adapters must not be called on failure.
- [ ] Run focused tests and verify failures.
- [ ] Add one shared cheap freshness precondition and call it from each boundary; do not make a second LLM call at publish time.
- [ ] Run focused publishing/recovery tests; expect green.
- [ ] Commit `feat(publish): require fresh QA for generated posts`.

### Task 8: Bundle import, Facts UI, and generation preflight

**Files:**
- Modify: `apps/web/app/(dashboard)/publish/writer/ContentDnaPanel.tsx`
- Modify: `apps/web/app/(dashboard)/publish/writer/WriterView.tsx`
- Modify: `apps/web/app/(dashboard)/publish/writer/writer-model.ts`
- Modify: `apps/web/app/(dashboard)/publish/writer/writer-copy.ts`
- Modify: `apps/web/app/(dashboard)/product/ProductProfileForm.tsx`
- Create: `apps/web/app/(dashboard)/publish/writer/GenerationPreflight.tsx`
- Create: `apps/web/app/api/v1/writer/samples/import/route.ts`
- Create: `apps/web/test/golden-sample-import-route.test.ts`
- Create: `apps/web/test/generation-preflight.test.ts`

- [ ] Write failing route/component-contract tests for owner/admin idempotent import, required language choice, adaptive/include/exclude mention modes, facts history/confirmation controls, and review display of bindings/findings/skips.
- [ ] Run focused tests and verify failures.
- [ ] Implement the import route, shared preflight UI, Product Profile facts section, and review metadata; include German/English/Spanish UI copy where existing Writer copy supports those locales.
- [ ] Run focused and existing Writer UI tests; expect green.
- [ ] Commit `feat(ui): add golden sample and narrative QA controls`.

### Task 9: Connect remaining user-facing generation flows

**Files:**
- Modify: `apps/web/lib/templates/draft-service.ts`
- Modify: `apps/web/lib/content/splinter.ts`
- Modify: `apps/web/app/api/v1/discover/draft/route.ts`
- Modify: relevant composer/start-flow call sites identified by `rg 'generateConcepts|generateChannelNativeVariants|draft' apps/web`
- Create: `apps/web/test/generation-context-callsites.test.ts`

- [ ] Write failing call-site contract tests that templates, compose adaptation, splinter/reuse, and community drafts pass explicit language/context and re-check mention compliance; analytical feedback/ranking paths must not load personal samples.
- [ ] Run the contract test and verify failures.
- [ ] Route user-facing generators through the shared resolver and existing gate, using conservative omit for unknown community rules.
- [ ] Run generation, discovery, template, and splinter tests; expect green.
- [ ] Commit `feat(generation): share narrative context across flows`.

### Task 10: Full verification and handoff

**Files:**
- Modify: this plan’s checkboxes only

- [ ] Run `npx vitest run` in `apps/web`; expect all tests green.
- [ ] Run `npx tsc --noEmit` in `apps/web`; expect no diagnostics.
- [ ] Run `npx tsc --noEmit` in `apps/mcp-server`; expect no diagnostics.
- [ ] Search new service-role queries for missing `workspace_id` scopes and sensitive `select('*')` usage.
- [ ] Confirm migration 023 has not been applied live and no deployment occurred.
- [ ] Review `git diff --check`, `git status --short`, and commit history.
- [ ] Use verification-before-completion and finishing-a-development-branch before reporting completion.
