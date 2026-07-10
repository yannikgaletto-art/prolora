export default function PublicBoardNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-sm font-semibold text-gray-900">Board not found</h1>
      <p className="mt-1 text-sm text-gray-500">
        This link doesn&apos;t match a published feedback board.
      </p>
    </div>
  );
}
