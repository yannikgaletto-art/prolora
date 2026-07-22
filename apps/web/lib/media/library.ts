// Media library + download guards. Every media file lives under
// workspaces/<workspace_id>/media/<uuid>/original.<ext> (uploads, URL ingest,
// AI generations all share this shape) — so the key prefix doubles as the
// workspace scoping check (Invariante 2: never serve a key you didn't verify).
import { getServiceDb, type MediaGenerationRow, type MediaRef } from '@/lib/db';
import { MEDIA_BUCKET } from '@/lib/media/transform';

/** True iff the key is a well-formed media key belonging to this workspace. */
export function isWorkspaceMediaKey(workspaceId: string, key: string): boolean {
  if (!workspaceId || !key.startsWith(`workspaces/${workspaceId}/media/`)) return false;
  const segments = key.split('/');
  return segments.length === 5 && segments.every((segment) => segment.length > 0 && segment !== '..');
}

/** Stable, human-scannable attachment name: prolora-<uuid-prefix>.<ext>. */
export function downloadFilename(key: string): string {
  const segments = key.split('/');
  const uuid = segments[3] ?? 'media';
  const file = segments[segments.length - 1] ?? '';
  const dot = file.lastIndexOf('.');
  const extension = dot > -1 ? file.slice(dot + 1) : 'bin';
  return `prolora-${uuid.slice(0, 8)}.${extension}`;
}

export interface WorkspaceMediaItem {
  storage_key: string;
  type: MediaRef['type'];
  mime_type: string;
  created_at: string | null;
  /** Prompt, when the file came from an AI generation. */
  prompt: string | null;
  source: 'generated' | 'uploaded';
  /** How many post groups reference this file. */
  used_in_posts: number;
}

function typeFromMime(mimeType: string): MediaRef['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

// Orphan uploads (never attached to a post) exist only in Storage, so we
// diff the folder listing against the keys known from the DB — but fetch
// per-folder details only for the unknown remainder, keeping requests bounded.
const MAX_ORPHAN_LOOKUPS = 50;

/**
 * All media of a workspace, newest first: post attachments, AI generations
 * (including never-attached ones) and orphan uploads.
 */
export async function listWorkspaceMedia(
  workspaceId: string,
  limit = 100
): Promise<WorkspaceMediaItem[]> {
  const db = getServiceDb();
  const prefix = `workspaces/${workspaceId}/media`;
  const items = new Map<string, WorkspaceMediaItem>();

  // 1. Media attached to posts — also yields the usage counts.
  const { data: groups, error: groupsError } = await db
    .from('post_groups')
    .select('media, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (groupsError) throw new Error(`[media-library] post_groups query failed: ${groupsError.message}`);

  for (const group of groups ?? []) {
    for (const ref of (group.media ?? []) as MediaRef[]) {
      if (!isWorkspaceMediaKey(workspaceId, ref.storage_key)) continue;
      const existing = items.get(ref.storage_key);
      if (existing) {
        existing.used_in_posts += 1;
      } else {
        items.set(ref.storage_key, {
          storage_key: ref.storage_key,
          type: ref.type,
          mime_type: ref.mime_type,
          created_at: group.created_at,
          prompt: null,
          source: 'uploaded',
          used_in_posts: 1,
        });
      }
    }
  }

  // 2. AI generations — covers the paid-but-never-attached case and adds prompts.
  const { data: generations, error: genError } = await db
    .from('media_generations')
    .select('id, prompt, kind, storage_key, mime_type, created_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'succeeded')
    .not('storage_key', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)
    .returns<Pick<MediaGenerationRow, 'id' | 'prompt' | 'kind' | 'storage_key' | 'mime_type' | 'created_at'>[]>();
  if (genError) throw new Error(`[media-library] generations query failed: ${genError.message}`);

  for (const generation of generations ?? []) {
    const key = generation.storage_key;
    if (!key || !isWorkspaceMediaKey(workspaceId, key)) continue;
    const existing = items.get(key);
    if (existing) {
      existing.prompt = generation.prompt;
      existing.source = 'generated';
      existing.created_at = generation.created_at;
    } else {
      items.set(key, {
        storage_key: key,
        type: generation.kind,
        mime_type: generation.mime_type ?? 'application/octet-stream',
        created_at: generation.created_at,
        prompt: generation.prompt,
        source: 'generated',
        used_in_posts: 0,
      });
    }
  }

  // 3. Orphan uploads: folders in Storage whose uuid no known key references.
  const knownUuids = new Set([...items.keys()].map((key) => key.split('/')[3]));
  const { data: folders } = await db.storage.from(MEDIA_BUCKET).list(prefix, { limit: 1000 });
  const unknown = (folders ?? []).filter((entry) => entry.name && !knownUuids.has(entry.name));

  for (const folder of unknown.slice(0, MAX_ORPHAN_LOOKUPS)) {
    const { data: files } = await db.storage.from(MEDIA_BUCKET).list(`${prefix}/${folder.name}`, { limit: 1 });
    const file = files?.[0];
    if (!file?.name) continue;
    const key = `${prefix}/${folder.name}/${file.name}`;
    const mimeType =
      (file.metadata as { mimetype?: string } | null)?.mimetype ?? 'application/octet-stream';
    items.set(key, {
      storage_key: key,
      type: typeFromMime(mimeType),
      mime_type: mimeType,
      created_at: file.created_at ?? null,
      prompt: null,
      source: 'uploaded',
      used_in_posts: 0,
    });
  }

  return [...items.values()]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, limit);
}
