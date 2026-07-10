'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/app/components/Button';
import { Textarea } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { finishOnboarding } from './actions';

interface ManualFeedbackResponse {
  raw_feedback_id: string;
  status: string;
}

// POST /api/v1/feedback accepts manual content per its Zod schema
// (manualFeedbackSchema in app/api/v1/feedback/route.ts) — this is a real
// mutation, not a mocked one, so it is submitted via fetchApi like any other
// interactive Client Component form. Once it succeeds, the hidden form below
// auto-submits to the finishOnboarding Server Action to mark onboarding done
// and redirect to /listen.
export function FeedbackQuickAdd() {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishFormRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) {
      setError('Write the feedback before continuing.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await fetchApi<ManualFeedbackResponse>('/v1/feedback', {
        method: 'POST',
        body: JSON.stringify({ content: content.trim(), source_platform: 'manual' }),
      });
      finishFormRef.current?.requestSubmit();
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Textarea
          aria-label="Feedback content"
          rows={4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Paste or write a piece of customer feedback…"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" loading={submitting} className="self-start">
          Add feedback &amp; finish
        </Button>
      </form>

      <form ref={finishFormRef} action={finishOnboarding} className="hidden">
        <input type="hidden" name="destination" value="listen" />
      </form>
    </>
  );
}
