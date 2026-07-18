# Publishing Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one post have an independently editable text and media variant for every connected account, with durable records used by publishing jobs.

**Architecture:** Store a connection-specific payload on `post_items`; keep `post_groups` as the common source only. The create-post service resolves each connection's override, ingests every distinct media URL once, validates its resolved payload, and the publish job reads the item payload instead of global group media. The dashboard composes the same connection IDs it submits, so two accounts on the same platform are no longer conflated.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Supabase Postgres/Storage, Inngest, Vitest.

---

### Task 1: Add durable per-item payload storage

**Files:**
- Create: `supabase/migrations/005_post_item_payload.sql`
- Modify: `apps/web/lib/db.ts`
- Test: `apps/web/test/post-item-payload.test.ts`

- [ ] **Step 1: Write the failing type contract test**

```ts
import { expect, test } from 'vitest';
import type { PostItemRow } from '@/lib/db';

test('post item exposes its resolved content and media payload', () => {
  const item: Pick<PostItemRow, 'resolved_content' | 'media'> = {
    resolved_content: 'French copy',
    media: [{ type: 'image', storage_key: 'workspaces/a/media/a.png', mime_type: 'image/png' }],
  };
  expect(item.resolved_content).toBe('French copy');
  expect(item.media).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test and verify it fails because `PostItemRow` has no resolved payload**

Run: `npm test --workspace=apps/web -- post-item-payload.test.ts`

Expected: TypeScript test compilation reports missing `resolved_content` and `media` properties.

- [ ] **Step 3: Add the migration and row fields**

```sql
ALTER TABLE post_items
  ADD COLUMN resolved_content TEXT,
  ADD COLUMN media JSONB NOT NULL DEFAULT '[]';

UPDATE post_items
SET resolved_content = adapted_content
WHERE resolved_content IS NULL AND adapted_content IS NOT NULL;
```

```ts
export interface PostItemRow {
  // existing fields
  adapted_content: string | null;
  resolved_content: string | null;
  media: MediaRef[];
}
```

- [ ] **Step 4: Run the focused test**

Run: `npm test --workspace=apps/web -- post-item-payload.test.ts`

Expected: PASS.

### Task 2: Address overrides by connection, not platform

**Files:**
- Modify: `packages/shared/types.ts`
- Modify: `packages/shared/validation.ts`
- Modify: `apps/web/lib/posts/create-post.ts`
- Test: `apps/web/test/create-post-overrides.test.ts`

- [ ] **Step 1: Write a failing service test for two accounts on one platform**

```ts
test('uses separate overrides for two LinkedIn connection IDs', async () => {
  const request = {
    content: 'Master copy',
    platforms: [linkedinA, linkedinB],
    connection_overrides: {
      [linkedinA]: { content: 'Founder voice' },
      [linkedinB]: { content: 'Recruiting voice' },
    },
  };
  await createPost(workspaceId, request, 'api');
  expect(insertedItems.map((item) => item.resolved_content)).toEqual(['Founder voice', 'Recruiting voice']);
});
```

- [ ] **Step 2: Run the test and verify it fails because `connection_overrides` is rejected**

Run: `npm test --workspace=apps/web -- create-post-overrides.test.ts`

Expected: FAIL with the current schema rejecting `connection_overrides`.

- [ ] **Step 3: Extend the shared request contract**

```ts
connection_overrides?: Record<string, {
  content?: string;
  media?: MediaItem[];
}>;
```

```ts
connection_overrides: z.record(z.string().uuid(), z.object({
  content: z.string().min(1).max(10000).optional(),
  media: z.array(mediaItemSchema).max(10).optional(),
})).optional(),
```

- [ ] **Step 4: Resolve, ingest and validate each connection payload in `createPost`**

Replace the platform-only override rejection with a per-connection resolver. Ingest the post-level media once; for each override media array call `ingestMedia(workspaceId, override.media)` and store that returned `MediaRef[]` on the matching `post_items` row. Persist `resolved_content` for every item, even when it equals the master text, so retries are deterministic.

- [ ] **Step 5: Run the focused test**

Run: `npm test --workspace=apps/web -- create-post-overrides.test.ts`

Expected: PASS; both LinkedIn item rows contain their own content.

### Task 3: Publish each item payload

**Files:**
- Modify: `apps/web/lib/inngest/functions/publish-post.ts`
- Test: `apps/web/test/publish-post-payload.test.ts`

- [ ] **Step 1: Write the failing publish test**

```ts
test('publishes the stored item media instead of group media', async () => {
  await publishPost({ postItemId, workspaceId });
  expect(adapter.publish).toHaveBeenCalledWith(expect.objectContaining({
    content: 'Account-specific text',
    media: [expect.objectContaining({ storage_key: 'workspaces/a/media/account.png' })],
  }));
});
```

- [ ] **Step 2: Run the test and verify it fails against the group-media implementation**

Run: `npm test --workspace=apps/web -- publish-post-payload.test.ts`

Expected: FAIL because the job currently reads `group.media`.

- [ ] **Step 3: Read `item.resolved_content` and `item.media` first**

Use `item.resolved_content ?? item.adapted_content ?? group.original_content` for text and `item.media.length > 0 ? item.media : group.media` for the migration-safe media fallback. Keep storage keys private and keep calling `prepareImageForPlatform()` before adapters receive signed URLs.

- [ ] **Step 4: Run the focused test and complete suite**

Run: `npm test --workspace=apps/web -- publish-post-payload.test.ts && npm test --workspace=apps/web`

Expected: focused test PASS and all existing tests PASS.

### Task 4: Add an account-specific editor in the composer

**Files:**
- Modify: `apps/web/app/(dashboard)/publish/PostComposer.tsx`
- Test: `apps/web/test/post-composer-overrides.test.tsx`

- [ ] **Step 1: Write a failing interaction test**

```tsx
test('submits the edited copy under the selected connection ID', async () => {
  render(<PostComposer connections={[linkedInA, linkedInB]} wizardStrings={strings} />);
  await user.click(screen.getByLabelText('Edit Founder account'));
  await user.clear(screen.getByLabelText('Founder account content'));
  await user.type(screen.getByLabelText('Founder account content'), 'Founder voice');
  await user.click(screen.getByRole('button', { name: 'Publish now' }));
  expect(fetchMock).toHaveBeenCalledWith('/v1/posts', expect.objectContaining({
    body: expect.stringContaining('connection_overrides'),
  }));
});
```

- [ ] **Step 2: Run the test and verify it fails because no per-account editor exists**

Run: `npm test --workspace=apps/web -- post-composer-overrides.test.tsx`

Expected: FAIL with no `Edit Founder account` control.

- [ ] **Step 3: Implement the minimal editor**

Add an “Individualize” section after account selection. It must list selected connection names, let the user edit only that account's text, and let the user choose “use master media” or supply account-specific media URLs. Build `connection_overrides` from non-empty differences only; do not send the deprecated platform-only override field from the dashboard.

- [ ] **Step 4: Run the focused test and full test suite**

Run: `npm test --workspace=apps/web -- post-composer-overrides.test.tsx && npm test --workspace=apps/web`

Expected: PASS.

### Task 5: Verify production behavior and migration safety

**Files:**
- Modify: `apps/web/lib/gdpr/export-service.ts`
- Test: `apps/web/test/gdpr-export-post-payload.test.ts`

- [ ] **Step 1: Write a failing export contract test**

```ts
test('exports resolved post item variants without tokens', async () => {
  const result = await exportWorkspace(workspaceId);
  expect(result.post_items[0]).toMatchObject({ resolved_content: 'French copy', media: [] });
  expect(JSON.stringify(result)).not.toContain('access_token_encrypted');
});
```

- [ ] **Step 2: Run the test and verify it fails because the new item fields are omitted**

Run: `npm test --workspace=apps/web -- gdpr-export-post-payload.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add `resolved_content, media` to the post-item export projection**

```ts
post_items: 'id, post_group_id, connection_id, platform, adapted_content, resolved_content, media, status, platform_post_id, platform_url, published_at, error_message, metrics, metrics_updated_at, created_at',
```

- [ ] **Step 4: Verify build and deploy only after migration is applied**

Run: `npm test --workspace=apps/web && npm run build --workspace=apps/web`

Expected: all tests PASS and Next.js build succeeds. Apply `005_post_item_payload.sql` in Supabase before deploying the code, then execute a non-publishing scheduled test with a disposable connection.
