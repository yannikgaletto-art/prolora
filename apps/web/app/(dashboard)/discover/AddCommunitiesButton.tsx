'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/components/Button';
import { Modal } from '@/app/components/Modal';
import { Textarea } from '@/app/components/Input';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';

interface MapCommunitiesResponse {
  communities: unknown[];
  total: number;
}

// Client island (F0-4, Pfad B): the only interactive piece on an otherwise
// server-rendered page. Calls POST /v1/discover/communities, then
// router.refresh() so the Server Component re-reads the now-updated
// discovery_communities table.
export function AddCommunitiesButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [productDescription, setProductDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await fetchApi<MapCommunitiesResponse>('/v1/discover/communities', {
        method: 'POST',
        body: JSON.stringify({
          product_description: productDescription,
          target_audience: targetAudience,
        }),
      });
      setToast({
        variant: 'success',
        message:
          result.total === 0
            ? 'No new relevant communities were found.'
            : `Found ${result.total} matching ${result.total === 1 ? 'community' : 'communities'}.`,
      });
      setOpen(false);
      setProductDescription('');
      setTargetAudience('');
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Communities</Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Map your ICP to communities"
        description="Describe your product and audience — Prolora finds relevant communities and checks their posting rules."
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" form="add-communities-form" loading={submitting}>
              Find Communities
            </Button>
          </>
        }
      >
        <form id="add-communities-form" onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            label="Product description"
            name="product_description"
            rows={3}
            minLength={10}
            maxLength={2000}
            required
            value={productDescription}
            onChange={(event) => setProductDescription(event.target.value)}
            hint="What you're building, in a sentence or two."
          />
          <Textarea
            label="Target audience"
            name="target_audience"
            rows={3}
            minLength={10}
            maxLength={1000}
            required
            value={targetAudience}
            onChange={(event) => setTargetAudience(event.target.value)}
            hint="Who it's for — role, industry, pain point."
          />
        </form>
      </Modal>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
