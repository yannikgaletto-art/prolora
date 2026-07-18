-- GOAL-RUN6 repo hygiene: this fix previously lived as an in-place edit of
-- 002_rls_policies.sql, which migration tooling would silently skip on any
-- environment where 002 already ran. Shipped here as a real migration instead
-- (002 is reverted to its committed state). Idempotent: DROP IF EXISTS + CREATE.
--
-- Owner check is inlined directly (not via user_workspace_ids()) because this
-- policy lives on `workspaces` itself: routing the owner-path through the
-- self-referential helper causes Postgres to lose visibility of a row this
-- same statement just inserted when evaluated for INSERT ... RETURNING (e.g.
-- createWorkspace()'s .insert().select()). The membership path still goes
-- through the SECURITY DEFINER helper, which is required to avoid infinite
-- recursion with workspace_members' policies (which query workspaces back).

DROP POLICY IF EXISTS "workspace_select" ON workspaces;
CREATE POLICY "workspace_select" ON workspaces
  FOR SELECT USING (
    owner_id = auth.uid()
    OR id IN (SELECT public.user_workspace_ids())
  );
