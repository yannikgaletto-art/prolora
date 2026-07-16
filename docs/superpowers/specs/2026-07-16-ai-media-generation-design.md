# AI Media Generation Design

**Date:** 2026-07-16  
**Status:** Approved for implementation planning  
**Scope:** Cost-controlled image generation, 8-second video generation, upload, preview, storage, and per-account media assignment in the Prolora composer.

## Objective

Prolora users can create or upload a visual asset while composing a post, preview it, and attach it globally or to individual connected accounts. The feature must be safe for production, preserve workspace isolation, and enforce a hard AI media budget of EUR 10 per workspace and calendar month.

## Product Decisions

- Use one provider for the first production version: OpenAI.
- Use `gpt-image-2` for generated images.
- Use `sora-2` for video generation.
- Videos always have a duration of exactly 8 seconds.
- AI media is generated only after an explicit user action. Prolora never generates one asset automatically for every selected account.
- A generated master asset can be reused across accounts. Existing platform preparation creates cheaper technical variants without another AI generation.
- Users can attach a master asset to the whole post or override it for a selected connection.
- Users can also upload their own image or video without consuming the AI media budget.

Official capability references:

- GPT Image 2: https://developers.openai.com/api/docs/models/gpt-image-2
- Sora 2: https://developers.openai.com/api/docs/models/sora-2

## Composer Experience

The publish composer adds a `Media` card with three actions:

1. `Generate image`
2. `Generate 8-second video`
3. `Upload media`

Before an AI request, the user selects a format and supplies a prompt. Supported formats are square, portrait, and landscape. The confirmation view shows the estimated charge and the remaining monthly budget. Video generation requires an additional explicit confirmation because it is materially more expensive and slower than image generation.

While a request is running, the composer shows durable progress rather than holding an HTTP request open. A completed asset has a private preview and the actions `Use`, `Discard`, and `Generate again`. Regeneration is a new billable request and must pass the budget check again.

An accepted asset is assigned to the master post by default. The existing per-account section can replace the master media for an individual selected connection.

## Architecture

### API Boundary

Authenticated routes accept creation, status, and upload requests. Every route derives the workspace from the authenticated session; a client-supplied workspace ID is never trusted.

- `POST /api/v1/media/generations` validates the request, reserves budget, creates a generation record, and emits an Inngest event.
- `GET /api/v1/media/generations/:id` returns workspace-scoped status and preview metadata.
- `POST /api/v1/media/uploads` validates and stores a user-provided file without consuming AI budget.

The API returns storage keys and short-lived preview URLs. Permanent public media URLs are not stored.

### Generation Worker

An Inngest function performs the provider request outside the Vercel request lifecycle.

For images, it calls the OpenAI image generation endpoint with `gpt-image-2`, downloads the result, verifies the content type and byte limit, and stores it in the existing private Supabase `media` bucket.

For videos, it creates a `sora-2` job for exactly 8 seconds, polls with bounded backoff, downloads the completed MP4, validates it, and stores it in the same private bucket. The worker is idempotent: an already completed generation is never submitted a second time.

### Media Storage

Generated and uploaded originals use an obfuscated workspace path:

`workspaces/{workspaceId}/media/{assetId}/original.{extension}`

The existing publishing pipeline continues to create platform-specific variants. Originals remain private. Previews and publish-time downloads use short-lived signed URLs.

### Post Assignment

Accepted media is represented by the existing `MediaItem` contract. Master media is submitted in `CreatePostRequest.media`. Per-connection media is submitted through the existing `connection_overrides[connectionId].media` contract. The existing `post_items.media` storage and publish-job resolution remain the source of truth for the final connection-specific payload.

## Budget and Billing Safety

Each workspace has a fixed EUR 10 AI media limit per calendar month. The limit is enforced server-side.

The database records immutable budget ledger entries with:

- workspace
- generation
- calendar month
- estimated amount
- final amount when available
- state: `reserved`, `committed`, or `released`
- provider and model
- timestamps

Creating a generation performs an atomic budget reservation. The transaction fails when committed plus reserved spend would exceed EUR 10. A successful generation commits the reservation. Provider rejection, terminal failure, or cancellation releases it. Retried workers reuse the same reservation and generation record.

Provider prices are configuration, not UI constants. The server calculates estimates from versioned price settings. The UI displays the server-provided estimate. The hard limit is based on ledger values, not a browser calculation.

If EUR and provider billing currency differ, Prolora uses a conservative configurable exchange rate and rounds reservations up. This prevents the provider charge from exceeding the workspace limit because of exchange-rate movement.

## Security and Privacy

- `OPENAI_API_KEY` exists only in server-side environment variables.
- All generation, upload, status, preview, and delete operations verify workspace ownership.
- Uploads are restricted by media type, extension, decoded file type, and size.
- Provider output is downloaded by the trusted worker and revalidated before storage.
- The private Supabase bucket and signed-URL pattern remain mandatory.
- Prompts and generation metadata are included in GDPR export and workspace deletion.
- Logs contain generation IDs and provider status but never API keys, signed URLs, or binary media.

## Failure Handling

- Provider throttling and temporary network failures retry with bounded exponential backoff.
- Policy rejection and invalid input fail without retry and release the budget reservation.
- Provider success followed by storage failure retries storage without creating a new provider job.
- Stale reservations are reconciled by a scheduled function that checks the generation state before release.
- A failed asset remains visible with a safe error message and a retry action.
- If the API key is missing, generation actions are disabled and the API returns a configuration error; uploads and publishing without generation continue to work.

## Testing and Acceptance Criteria

### Unit Tests

- Estimate calculation and conservative currency conversion.
- Atomic reservation accepts spend below EUR 10 and rejects spend above it.
- Failed and cancelled jobs release reservations.
- Worker retries do not create duplicate provider jobs or ledger charges.
- MIME, size, and workspace checks reject invalid uploads and cross-workspace access.
- Master and connection-specific media resolve to the correct post item.

### Integration Tests

- Image success: request, worker, private storage, preview, and composer assignment.
- Video success: exact 8-second request, async polling, MP4 storage, and assignment.
- Provider failure: terminal status and released reservation.
- Concurrent requests cannot exceed the workspace limit.
- Generated media reaches the existing platform preparation and publish pipeline.

### Production Verification

- Generate one low-cost image and confirm its private preview and post attachment.
- Generate one 8-second test video and confirm the worker run, MP4 storage, and preview.
- Confirm Vercel logs expose no secret or signed URL.
- Confirm the budget display and ledger match both requests.
- Confirm a forced request above the remaining budget is blocked before contacting OpenAI.

## Explicit Non-Goals for This Version

- Multiple media-generation providers or automatic provider fallback.
- Automatic AI generation for every connected account.
- Long-form video, video editing, or arbitrary duration.
- Automatic publication of a generated asset without user preview and acceptance.
- End-user billing or paid credit packages. The first version enforces an internal workspace allowance only.

