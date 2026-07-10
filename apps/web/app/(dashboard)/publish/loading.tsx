import { Spinner } from '@/app/components/Spinner';

export default function PublishLoading() {
  return (
    <div className="flex min-h-64 items-center justify-center text-gray-400">
      <Spinner size="lg" label="Loading publish" />
    </div>
  );
}
