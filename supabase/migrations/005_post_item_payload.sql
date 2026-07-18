-- Connection-specific publishing payloads. post_groups remains the common
-- source; post_items is the durable, retry-safe account variant.
ALTER TABLE post_items
  ADD COLUMN resolved_content TEXT,
  ADD COLUMN media JSONB NOT NULL DEFAULT '[]';

UPDATE post_items
SET resolved_content = adapted_content
WHERE resolved_content IS NULL AND adapted_content IS NOT NULL;
