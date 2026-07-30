# Writer Autopilot Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, approval-first `Writer` pilot that learns a versioned Content DNA from Golden Samples, creates one grounded channel-native recommendation, requires a human approval snapshot, and safely materializes approved content into the existing publishing pipeline.

**Architecture:** The implementation extends the existing Content Factory without replacing any current Publish flow. New writer-owned tables and routes remain isolated; transactional PostgreSQL RPCs close the factory-to-delivery and concurrency gaps. Existing `post_groups` and `post_items` remain the sole publishing authority.

**Tech Stack:** Next.js 15 App Router, React, TypeScript strict mode, Supabase/PostgreSQL/RLS, Inngest, Anthropic client wrappers, Zod, Vitest, Tailwind CSS.

---

## File map

### Database

- Create `supabase/migrations/020_writer_integrity.sql` — approval state, variant delivery link, transactional transition/materialization/claim RPCs.
- Create `supabase/migrations/021_content_dna.sql` — `content_samples` and immutable `content_dna_profiles`.
- Create `supabase/migrations/022_writer_pilot.sql` — policies and review bundles.

### Writer domain

- Create `apps/web/lib/writer/types.ts` — writer-owned row and DTO types.
- Create `apps/web/lib/writer/hash.ts` — canonical JSON and SHA-256 hashing.
- Create `apps/web/lib/writer/samples.ts` — sample CRUD and duplicate limits.
- Create `apps/web/lib/writer/dna.ts` — deterministic feature extraction, profile versioning, confidence and prompt rules.
- Create `apps/web/lib/writer/policy.ts` — default-paused policy and caps.
- Create `apps/web/lib/writer/reviews.ts` — immutable snapshot creation, approval validation and rejection.
- Create `apps/web/lib/writer/materialize.ts` — typed RPC boundary to delivery.
- Create `apps/web/lib/writer/run.ts` — bounded orchestration to `awaiting_approval`.
- Create `apps/web/lib/writer/metrics.ts` — pilot counters and edit-distance functions.

### API

- Create routes under `apps/web/app/api/v1/writer/` for status, policy, run, reviews, samples and DNA.

### UI

- Modify `apps/web/app/(dashboard)/publish/PublishTabs.tsx` — add only the `Writer` tab.
- Create `apps/web/app/(dashboard)/publish/writer/page.tsx`.
- Create `apps/web/app/(dashboard)/publish/writer/WriterView.tsx`.
- Create `apps/web/app/(dashboard)/publish/writer/ReviewCard.tsx`.
- Create `apps/web/app/(dashboard)/publish/writer/ContentDnaPanel.tsx`.
- Create `apps/web/app/(dashboard)/publish/writer/writer-copy.ts`.

### Background jobs and compliance

- Create `apps/web/lib/inngest/functions/writer.ts`.
- Modify `apps/web/lib/inngest/functions/index.ts` and `apps/web/app/api/inngest/route.ts` to register writer jobs.
- Modify `apps/web/lib/gdpr/export-service.ts` only if it is not already dirty; otherwise add `apps/web/lib/writer/gdpr.ts` and call it from a new writer export seam.

### Tests

- Create focused Vitest files under `apps/web/test/writer-*.test.ts`.
- Extend publishing concurrency tests without changing platform adapters.

## Task 1: Integrity foundation

**Files:**
- Create: `supabase/migrations/020_writer_integrity.sql`
- Modify: `apps/web/lib/pipeline/state.ts`
- Modify: `apps/web/lib/inngest/functions/publish-post.ts`
- Test: `apps/web/test/writer-integrity.test.ts`
- Test: `apps/web/test/publish-claim.test.ts`

- [ ] **Step 1: Write failing state and claim tests**

Test that `awaiting_approval` is a valid state, only `gated -> awaiting_approval`, `awaiting_approval -> drafted|scheduled|rejected`, and exactly one concurrent claim result is accepted.

```ts
expect(canTransition('gated', 'awaiting_approval')).toBe(true);
expect(canTransition('awaiting_approval', 'scheduled')).toBe(true);
expect(canTransition('awaiting_approval', 'published')).toBe(false);
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
npm test --workspace=apps/web -- --run test/writer-integrity.test.ts test/publish-claim.test.ts
```

Expected: FAIL because the state and claim RPC wrapper do not exist.

- [ ] **Step 3: Add migration 020**

The migration must:

```sql
ALTER TABLE post_items
  ADD COLUMN IF NOT EXISTS content_item_variant_id UUID
  REFERENCES content_item_variants(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_items_content_variant
  ON post_items(content_item_variant_id)
  WHERE content_item_variant_id IS NOT NULL;
```

Replace the `content_items_state_check` constraint with the existing states plus `awaiting_approval`. Add transaction-safe functions using `SELECT ... FOR UPDATE`, explicit workspace checks and compare-and-set semantics:

```sql
transition_content_item_atomic(
  p_workspace_id UUID,
  p_item_id UUID,
  p_expected_state TEXT,
  p_to_state TEXT,
  p_reason TEXT,
  p_actor TEXT,
  p_actor_id TEXT,
  p_metadata JSONB,
  p_scheduled_at TIMESTAMPTZ
)
```

```sql
materialize_writer_bundle(
  p_workspace_id UUID,
  p_review_id UUID,
  p_snapshot_hash TEXT
)
```

```sql
claim_post_item(
  p_workspace_id UUID,
  p_post_item_id UUID,
  p_attempt_id UUID,
  p_lease_until TIMESTAMPTZ
)
```

Every function must set `search_path = public`, reject cross-workspace rows and return the winning row/boolean.

- [ ] **Step 4: Update the TypeScript state machine**

Add `awaiting_approval` to `CONTENT_ITEM_STATES`, the row type and transition matrix. Make the persisted transition path call the RPC, falling back to the legacy path only when the RPC is absent and Writer is not the caller.

- [ ] **Step 5: Replace the publish claim**

Call `claim_post_item` before any adapter request. If the RPC returns false, return `already_claimed` without performing external work. Store `attempt_id`, `claimed_at` and `lease_until` in the status payload supported by the migration.

- [ ] **Step 6: Run focused and regression tests**

```bash
npm test --workspace=apps/web -- --run test/writer-integrity.test.ts test/publish-claim.test.ts test/pipeline-state.test.ts test/publish-post.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit only integrity files**

```bash
git add supabase/migrations/020_writer_integrity.sql apps/web/lib/pipeline/state.ts apps/web/lib/inngest/functions/publish-post.ts apps/web/test/writer-integrity.test.ts apps/web/test/publish-claim.test.ts
git commit -m "fix: make writer delivery transitions atomic"
```

## Task 2: Content DNA storage and pure analysis

**Files:**
- Create: `supabase/migrations/021_content_dna.sql`
- Create: `apps/web/lib/writer/types.ts`
- Create: `apps/web/lib/writer/hash.ts`
- Create: `apps/web/lib/writer/dna.ts`
- Test: `apps/web/test/writer-dna.test.ts`
- Test: `apps/web/test/writer-hash.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

Cover canonical key ordering, stable hashes, duplicate sample-set hashes, cold-start confidence and locked-rule preservation.

```ts
expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
expect(profileConfidence(2)).toBe('low');
expect(profileConfidence(5)).toBe('usable');
expect(profileConfidence(15)).toBe('precise');
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test --workspace=apps/web -- --run test/writer-dna.test.ts test/writer-hash.test.ts
```

- [ ] **Step 3: Add migration 021**

Create `content_samples` and `content_dna_profiles` exactly as defined in the design. Add RLS policies through `user_workspace_ids()`, explicit workspace indexes and unique active-profile protection:

```sql
CREATE UNIQUE INDEX uq_content_dna_active
  ON content_dna_profiles(workspace_id)
  WHERE status = 'active';
```

- [ ] **Step 4: Implement writer types and stable hashing**

Use Web Crypto-compatible `crypto.createHash('sha256')` on the server. Canonical JSON recursively sorts object keys and preserves array order.

- [ ] **Step 5: Implement deterministic DNA extraction**

The first pilot derives transparent features without a second provider:

- median sentence length
- median paragraph length
- first-person rate
- question rate
- exclamation rate
- list usage
- CTA presence
- common opening shapes
- preferred whitespace density

Return `profile`, per-feature confidence and `promptRules`. Preserve user-locked rules during rebuild.

- [ ] **Step 6: Run tests**

```bash
npm test --workspace=apps/web -- --run test/writer-dna.test.ts test/writer-hash.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/021_content_dna.sql apps/web/lib/writer/types.ts apps/web/lib/writer/hash.ts apps/web/lib/writer/dna.ts apps/web/test/writer-dna.test.ts apps/web/test/writer-hash.test.ts
git commit -m "feat: add versioned content DNA foundation"
```

## Task 3: Sample and DNA APIs

**Files:**
- Create: `apps/web/lib/writer/samples.ts`
- Create: `apps/web/app/api/v1/writer/samples/route.ts`
- Create: `apps/web/app/api/v1/writer/samples/[id]/route.ts`
- Create: `apps/web/app/api/v1/writer/dna/route.ts`
- Create: `apps/web/app/api/v1/writer/dna/rebuild/route.ts`
- Test: `apps/web/test/writer-samples-route.test.ts`
- Test: `apps/web/test/writer-dna-route.test.ts`

- [ ] **Step 1: Write route tests**

Verify workspace scoping, content limits, duplicate `409`, maximum 50 active samples, low-confidence response and immutable profile version increments.

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test --workspace=apps/web -- --run test/writer-samples-route.test.ts test/writer-dna-route.test.ts
```

- [ ] **Step 3: Implement sample service**

Use explicit column allowlists, normalize line endings before hashing, and never expose embeddings. Missing migration returns `503 migration_pending`.

- [ ] **Step 4: Implement Zod-validated routes**

`POST /samples` accepts:

```ts
{
  kind: z.enum(['golden', 'avoid']),
  origin: z.enum(['pasted', 'published', 'imported']),
  content: z.string().trim().min(40).max(20_000),
  platform: platformSchema.optional(),
  source_post_item_id: z.string().uuid().optional(),
  source_url: z.string().url().optional(),
  label: z.string().trim().max(120).optional()
}
```

Rebuild creates a `building` version, computes features, supersedes the former active version and activates the new version only after a successful read-back.

- [ ] **Step 5: Run tests and commit**

```bash
npm test --workspace=apps/web -- --run test/writer-samples-route.test.ts test/writer-dna-route.test.ts
git add apps/web/lib/writer/samples.ts apps/web/app/api/v1/writer/samples apps/web/app/api/v1/writer/dna apps/web/test/writer-samples-route.test.ts apps/web/test/writer-dna-route.test.ts
git commit -m "feat: manage golden samples and DNA profiles"
```

## Task 4: Writer policy and immutable reviews

**Files:**
- Create: `supabase/migrations/022_writer_pilot.sql`
- Create: `apps/web/lib/writer/policy.ts`
- Create: `apps/web/lib/writer/reviews.ts`
- Create: `apps/web/lib/writer/materialize.ts`
- Create API routes for status, policy and reviews.
- Test: `apps/web/test/writer-policy.test.ts`
- Test: `apps/web/test/writer-review.test.ts`

- [ ] **Step 1: Write policy and snapshot tests**

Verify default `enabled=false`, mode fixed to `approval_required`, deterministic snapshot hash, stale hash rejection, owner/admin approval and member/viewer rejection.

- [ ] **Step 2: Add migration 022**

Create `workspace_writer_policies` and `writer_review_bundles` with RLS, one pending bundle per item, immutable snapshot checks and indexes for status/expiry.

- [ ] **Step 3: Implement policy service**

Use conservative defaults:

```ts
{
  enabled: false,
  mode: 'approval_required',
  dailyPostCap: 1,
  weeklyCreditCap: 10,
  minimumSignalStrength: 0.6,
  quietDays: [],
  timezone: 'Europe/Berlin'
}
```

- [ ] **Step 4: Implement review service**

Create the snapshot from exact variants, destination accounts, proposed slot, sources, consent, DNA/prompt/gate/policy versions and media metadata. Store both complete canonical payload and SHA-256 hash.

- [ ] **Step 5: Implement approval transaction boundary**

The approve route:

1. authenticates user and role,
2. reloads the pending review,
3. recomputes and compares the hash,
4. rechecks consent and selected connections,
5. calls `materialize_writer_bundle`,
6. returns the existing post group id on duplicate clicks.

- [ ] **Step 6: Run tests and commit**

```bash
npm test --workspace=apps/web -- --run test/writer-policy.test.ts test/writer-review.test.ts
git add supabase/migrations/022_writer_pilot.sql apps/web/lib/writer/policy.ts apps/web/lib/writer/reviews.ts apps/web/lib/writer/materialize.ts apps/web/app/api/v1/writer/status apps/web/app/api/v1/writer/policy apps/web/app/api/v1/writer/reviews apps/web/test/writer-policy.test.ts apps/web/test/writer-review.test.ts
git commit -m "feat: add approval-bound writer reviews"
```

## Task 5: Bounded Writer orchestration

**Files:**
- Create: `apps/web/lib/writer/run.ts`
- Create: `apps/web/app/api/v1/writer/run/route.ts`
- Create: `apps/web/lib/inngest/functions/writer.ts`
- Modify: `apps/web/lib/inngest/functions/index.ts`
- Modify: `apps/web/app/api/inngest/route.ts`
- Test: `apps/web/test/writer-run.test.ts`
- Test: `apps/web/test/writer-repair.test.ts`

- [ ] **Step 1: Write orchestration tests**

Mock inventory, concept generation, channel variants, gate and slot allocator. Assert one selected signal, one recommended concept, at most three repairs, no scheduling before approval, policy caps and paused behavior.

- [ ] **Step 2: Implement run orchestration**

Reuse existing `listSignals`, `createContentItem`, concept generation, `generateChannelNativeVariants`, `runQualityGate` and `nextFreePostingSlot`. Rank by strength, freshness, proof availability, content-mix deficit and duplication.

The run ends with:

```ts
{
  contentItemId,
  reviewBundleId,
  state: 'awaiting_approval',
  proposedSlot,
  repairAttempts
}
```

- [ ] **Step 3: Implement bounded repairs**

Only machine-readable remedies are allowed. Persist every attempt. Stop after three and expose an exception; never continue charging.

- [ ] **Step 4: Register Writer events**

Add `writer/run` to the Inngest event map. Register an event-triggered worker first. Keep the cron disabled until the Canary phase.

- [ ] **Step 5: Run tests and commit**

```bash
npm test --workspace=apps/web -- --run test/writer-run.test.ts test/writer-repair.test.ts
git add apps/web/lib/writer/run.ts apps/web/app/api/v1/writer/run apps/web/lib/inngest/functions/writer.ts apps/web/lib/inngest/functions/index.ts apps/web/app/api/inngest/route.ts apps/web/test/writer-run.test.ts apps/web/test/writer-repair.test.ts
git commit -m "feat: orchestrate bounded writer runs"
```

## Task 6: Writer Pilot UI

**Files:**
- Modify: `apps/web/app/(dashboard)/publish/PublishTabs.tsx`
- Create: `apps/web/app/(dashboard)/publish/writer/page.tsx`
- Create: `apps/web/app/(dashboard)/publish/writer/WriterView.tsx`
- Create: `apps/web/app/(dashboard)/publish/writer/ReviewCard.tsx`
- Create: `apps/web/app/(dashboard)/publish/writer/ContentDnaPanel.tsx`
- Create: `apps/web/app/(dashboard)/publish/writer/writer-copy.ts`
- Test: `apps/web/test/writer-ui.test.ts`

- [ ] **Step 1: Write render and interaction tests**

Assert all original Publish labels still render, Writer is additional, paused state is visible, approve is primary, editing/rejection remain secondary and Content DNA shows honest confidence.

- [ ] **Step 2: Add the Writer tab**

Extend the `active` union with `writer` and add:

```ts
{ key: 'writer', label: 'Writer', href: '/publish/writer', badge: 'Pilot' }
```

Do not rename or reorder existing entries except inserting Writer after Start.

- [ ] **Step 3: Implement server page**

Load workspace, locale, policy, DNA and pending reviews through writer services. Missing migrations render a setup state rather than throwing.

- [ ] **Step 4: Implement client interactions**

Provide:

- Today / Content DNA / History segmented view
- pause/resume policy
- run-now button in paused Shadow mode
- exact per-channel preview
- approve, edit, alternate direction and reject actions
- sample paste/import/published-post selection
- rebuild DNA and locked rule display
- accessible focus, keyboard and reduced-motion behavior

- [ ] **Step 5: Run tests and commit**

```bash
npm test --workspace=apps/web -- --run test/writer-ui.test.ts test/publish-tabs.test.ts
git add apps/web/app/'(dashboard)'/publish/PublishTabs.tsx apps/web/app/'(dashboard)'/publish/writer apps/web/test/writer-ui.test.ts
git commit -m "feat: add isolated Writer pilot tab"
```

## Task 7: Metrics, GDPR and recovery visibility

**Files:**
- Create: `apps/web/lib/writer/metrics.ts`
- Create: `apps/web/lib/writer/gdpr.ts`
- Modify: `apps/web/lib/gdpr/export-service.ts`
- Extend Writer History UI.
- Test: `apps/web/test/writer-metrics.test.ts`
- Test: `apps/web/test/writer-gdpr.test.ts`

- [ ] **Step 1: Write metric and export tests**

Cover ready-to-approve rate, exception rate, review duration, normalized edit distance and export allowlists.

- [ ] **Step 2: Implement metrics**

Metrics are computed from review and transition records; no third analytics service is introduced.

- [ ] **Step 3: Extend GDPR**

Export and delete:

- content samples
- DNA profiles
- writer policy
- review bundles
- learning metadata

Never include embeddings, service secrets or unrelated workspace rows.

- [ ] **Step 4: Add recovery states to History**

Display `expired`, `invalidated`, `partially_published` and `unknown_external_state` with one safe next action. Unknown external state never exposes a Retry button.

- [ ] **Step 5: Run tests and commit**

```bash
npm test --workspace=apps/web -- --run test/writer-metrics.test.ts test/writer-gdpr.test.ts
git add apps/web/lib/writer/metrics.ts apps/web/lib/writer/gdpr.ts apps/web/lib/gdpr/export-service.ts apps/web/app/'(dashboard)'/publish/writer apps/web/test/writer-metrics.test.ts apps/web/test/writer-gdpr.test.ts
git commit -m "feat: measure and export Writer pilot data"
```

## Task 8: Full verification and deployment

**Files:**
- Modify only files required by findings.
- Create browser verification notes under `docs/verification/` if the repository already uses that directory.

- [ ] **Step 1: Run focused Writer suite**

```bash
npm test --workspace=apps/web -- --run test/writer-*.test.ts
```

Expected: all Writer tests PASS.

- [ ] **Step 2: Run the full web suite**

```bash
npm test --workspace=apps/web -- --run
```

Expected: all tests PASS.

- [ ] **Step 3: Run typechecks**

```bash
npm run typecheck --workspace=apps/web
npm run typecheck --workspace=apps/mcp-server
```

If the package uses no `typecheck` script, run `npx tsc --noEmit` in that workspace.

- [ ] **Step 4: Run production build**

```bash
npm run build --workspace=apps/web
```

Expected: exit 0; pre-existing Supabase warnings may remain documented but no Writer error is accepted.

- [ ] **Step 5: Run adversarial and concurrency verification**

Exercise:

- modified snapshot fields return `409`
- viewer/member approval returns `403`
- consent withdrawn after approval blocks
- 100 concurrent claim calls produce one winner
- duplicate approve clicks return one post group
- Prompt Injection samples remain inert
- missing migration renders `migration_pending`

- [ ] **Step 6: Present migrations for explicit approval**

Before applying `020`, `021` or `022`, show their full SQL and schema preflight result. Apply only after explicit user approval, per repository guardrail.

- [ ] **Step 7: Apply approved migrations and run live smoke**

Verify sample creation, DNA rebuild, Writer run, review, approval, scheduled rows and no external publish unless the selected slot is intentionally due.

- [ ] **Step 8: Commit final fixes**

Stage only Writer-owned or deliberately reviewed shared files. Do not stage existing unrelated Community/Discovery changes.

- [ ] **Step 9: Push `main`**

```bash
git push origin main
```

- [ ] **Step 10: Confirm Vercel production**

Use the connected Vercel deployment tooling to locate the deployment for the pushed commit, wait for terminal `READY`, inspect build logs for Writer errors, and open the production Writer route. Confirm existing Publish routes still respond.

## Plan self-review

- Spec coverage: navigation isolation, DNA, approval snapshot, materialization, bounded repair, learning metrics, GDPR, tests and Vercel are assigned to concrete tasks.
- Placeholders: none.
- Type consistency: `awaiting_approval`, `approval_required`, `writer_review_bundles`, `content_samples`, `content_dna_profiles` and `workspace_writer_policies` use the same names throughout.
- Existing dirty Community/Discovery files are excluded from Writer commits unless a later verified conflict requires an explicit decision.
