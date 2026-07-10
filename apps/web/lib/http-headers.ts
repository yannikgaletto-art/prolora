// Shared between middleware (writer) and the dashboard layout (reader).
// Kept out of middleware.ts so importing it never drags the Edge module —
// and its @supabase/ssr dependency — into a Server Component bundle.

// Layouts cannot read the current pathname in the App Router; middleware
// forwards it on every request.
export const PATHNAME_HEADER = 'x-pathname';
