'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { Button } from '@/app/components/Button';
import { Input, Textarea } from '@/app/components/Input';
import { Toast, type ToastMessage } from '@/app/components/Toast';

export interface SubmitFormProps {
  slug: string;
}

// Public submission form (F5-2, Oracle 6): POSTs to
// /v1/boards/:slug/items. Anonymous — no session required. On success it
// refreshes the Server Component list via router.refresh().
export function SubmitForm({ slug }: SubmitFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length < 3) {
      setToast({ variant: 'error', message: 'Title must be at least 3 characters.' });
      return;
    }
    setSubmitting(true);
    try {
      await fetchApi(`/v1/boards/${slug}/items`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          email: email.trim() || undefined,
        }),
      });
      setTitle('');
      setDescription('');
      setEmail('');
      setOpen(false);
      setToast({ variant: 'success', message: 'Thanks! Your idea has been submitted.' });
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {open ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-gray-200 bg-white px-5 py-5"
        >
          <h2 className="text-sm font-semibold text-gray-900">Submit an idea</h2>
          <Input
            label="Title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
            autoFocus
          />
          <Textarea
            label="Description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
            rows={4}
          />
          <Input
            label="Email (optional)"
            name="email"
            type="email"
            hint="Only used to notify you when this ships."
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" loading={submitting}>
              Submit
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <Button onClick={() => setOpen(true)}>Submit an idea</Button>
        </div>
      )}
      {toast && (
        <Toast variant={toast.variant} message={toast.message} action={toast.action} onDismiss={() => setToast(null)} />
      )}
    </>
  );
}
