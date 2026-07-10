import { Spinner } from '@/app/components/Spinner';

export default function PublicBoardLoading() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4">
      <Spinner size="lg" label="Loading board" />
    </div>
  );
}
