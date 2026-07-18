'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/components/Button';
import { Modal } from '@/app/components/Modal';
import { Textarea } from '@/app/components/Input';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { OpportunityThreadRow } from '@/lib/db';
import type { FeatureState } from '@/lib/system/doctor';

interface DraftResult {
  draft_id: string;
  content: string;
  reasoning: string;
  community_rules_check: { compliant: boolean; warnings: string[] };
  suggested_follow_up?: string;
}

interface ConfirmResult {
  opportunity_id: string;
  status: string;
  posted_at_confirmed: string;
}

export interface OpportunityActionsProps {
  opportunityId: string;
  status: OpportunityThreadRow['status'];
  initialDraft: string | null;
  aiState: FeatureState;
}

// Client island: no synchronous "post it for me" route exists (Invariante
// D1 — Prolora never posts on a community on the user's behalf), so the only
// actions here are "generate a draft to copy" and "tell us you posted it".
// A "Skip" button was considered and dropped — there is no route that PATCHes
// opportunity_threads.status to an arbitrary value, only POST /:id/confirm
// which hard-codes status to 'posted'.
export function OpportunityActions({ opportunityId, status, initialDraft, aiState }: OpportunityActionsProps) {
  const router = useRouter();
  const [draftOpen, setDraftOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftText, setDraftText] = useState(initialDraft ?? '');
  const [ruleWarnings, setRuleWarnings] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const canAct = status === 'new' || status === 'drafted';

  async function handleDraft() {
    if (aiState.state !== 'ready') {
      setToast({ variant: 'error', message: aiState.hint ?? 'AI drafting needs setup or available credits.' });
      return;
    }
    setDrafting(true);
    try {
      const result = await fetchApi<DraftResult>('/v1/discover/draft', {
        method: 'POST',
        body: JSON.stringify({ opportunity_id: opportunityId }),
      });
      setDraftText(result.content);
      setRuleWarnings(result.community_rules_check?.warnings ?? []);
      setDraftOpen(true);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setDrafting(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      await fetchApi<ConfirmResult>(`/v1/discover/${opportunityId}/confirm`, {
        method: 'POST',
        body: JSON.stringify(draftText ? { actual_content: draftText } : {}),
      });
      setToast({ variant: 'success', message: 'Marked as posted.' });
      setDraftOpen(false);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setConfirming(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draftText);
      setToast({ variant: 'success', message: 'Draft copied to clipboard.' });
    } catch {
      setToast({ variant: 'error', message: 'Could not copy — select and copy manually.' });
    }
  }

  if (!canAct) return null;

  return (
    <>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={handleDraft} loading={drafting} disabled={aiState.state !== 'ready'} title={aiState.state === 'ready' ? undefined : aiState.hint}>
          {status === 'drafted' ? 'Re-draft Reply' : 'Draft Reply'}
        </Button>
        {status === 'drafted' && (
          <Button variant="secondary" size="sm" onClick={handleConfirm} loading={confirming}>
            Confirm Posted
          </Button>
        )}
      </div>
      {aiState.state !== 'ready' && (
        <p className="mt-2 text-sm text-amber-700">{aiState.hint ?? 'AI drafting needs setup or available credits.'}</p>
      )}

      <Modal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title="Reply draft"
        description="Copy this and post it yourself on the community — Prolora never posts on your behalf."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraftOpen(false)}>
              Close
            </Button>
            <Button variant="secondary" onClick={handleCopy}>
              Copy
            </Button>
            <Button onClick={handleConfirm} loading={confirming}>
              Confirm Posted
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            label="Draft content"
            rows={8}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          {ruleWarnings.length > 0 && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="font-medium">Rule warnings</p>
              <ul className="mt-1 list-disc pl-4">
                {ruleWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
