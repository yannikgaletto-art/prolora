-- ============================================================
-- Prolora — Database Functions
-- pgvector similarity search + utility functions
-- ============================================================

-- Feedback duplicate detection via cosine similarity
CREATE OR REPLACE FUNCTION match_feedback_embeddings(
  query_embedding VECTOR(1536),
  match_workspace_id UUID,
  match_threshold FLOAT DEFAULT 0.92,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    fi.id,
    1 - (fi.embedding <=> query_embedding) AS similarity
  FROM feedback_items fi
  WHERE fi.workspace_id = match_workspace_id
    AND fi.embedding IS NOT NULL
    AND 1 - (fi.embedding <=> query_embedding) > match_threshold
  ORDER BY fi.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Increment board vote count (called after insert on board_votes)
CREATE OR REPLACE FUNCTION increment_vote_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE board_items
  SET vote_count = vote_count + 1
  WHERE id = NEW.board_item_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_board_vote_insert
  AFTER INSERT ON board_votes
  FOR EACH ROW
  EXECUTE FUNCTION increment_vote_count();

-- Decrement board vote count on delete
CREATE OR REPLACE FUNCTION decrement_vote_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE board_items
  SET vote_count = GREATEST(0, vote_count - 1)
  WHERE id = OLD.board_item_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER on_board_vote_delete
  AFTER DELETE ON board_votes
  FOR EACH ROW
  EXECUTE FUNCTION decrement_vote_count();

-- Auto-add workspace owner as admin member
CREATE OR REPLACE FUNCTION add_owner_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'admin')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_workspace_create
  AFTER INSERT ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION add_owner_as_member();

-- Reset weekly post counter for communities
CREATE OR REPLACE FUNCTION reset_community_weekly_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE discovery_communities
  SET posts_this_week = 0,
      week_reset_at = now()
  WHERE week_reset_at < now() - INTERVAL '7 days';
END;
$$;
