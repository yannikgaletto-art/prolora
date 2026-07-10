'use client';

// This page is a Client Component by design, not by default: voice_configs
// is a single-row-per-workspace settings object edited interactively (GET on
// load, PATCH on save) with no list/filter/pagination concerns that would
// benefit from server rendering — the whole page is one form bound to
// fetchApi, same shape as F0's onboarding form but without a Server Action.

import { useEffect, useState, type FormEvent } from 'react';
import { Card } from '@/app/components/Card';
import { Select } from '@/app/components/Select';
import { Input, Textarea } from '@/app/components/Input';
import { Button } from '@/app/components/Button';
import { Spinner } from '@/app/components/Spinner';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';

type Tone = 'casual' | 'professional' | 'technical' | 'empathetic';

interface VoiceConfig {
  id: string;
  workspace_id: string;
  name: string;
  tone: Tone;
  language: string;
  max_reply_length: number;
  include_personal_experience: boolean;
  avoid_patterns: string[];
  example_replies: string[];
  created_at: string;
}

const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'professional', label: 'Professional' },
  { value: 'technical', label: 'Technical' },
  { value: 'empathetic', label: 'Empathetic' },
];

export default function VoiceConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [avoidPatternsText, setAvoidPatternsText] = useState('');
  const [exampleRepliesText, setExampleRepliesText] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApi<{ voice_config: VoiceConfig }>('/v1/voice-config');
        if (cancelled) return;
        setConfig(result.voice_config);
        setAvoidPatternsText(result.voice_config.avoid_patterns.join(', '));
        setExampleRepliesText(result.voice_config.example_replies.join('\n'));
      } catch (error) {
        if (!cancelled) setToast({ variant: 'error', message: errorMessage(error) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    try {
      const patch = {
        tone: config.tone,
        language: config.language,
        max_reply_length: config.max_reply_length,
        include_personal_experience: config.include_personal_experience,
        avoid_patterns: avoidPatternsText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        example_replies: exampleRepliesText
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      };
      const result = await fetchApi<{ voice_config: VoiceConfig }>('/v1/voice-config', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setConfig(result.voice_config);
      setAvoidPatternsText(result.voice_config.avoid_patterns.join(', '));
      setExampleRepliesText(result.voice_config.example_replies.join('\n'));
      setToast({ variant: 'success', message: 'Voice settings saved.' });
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-gray-400">
        <Spinner size="lg" label="Loading voice settings" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center text-sm text-red-700">
        Could not load voice settings.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Reply voice</h1>
        <p className="mt-1 text-sm text-gray-500">
          How Prolora drafts replies on your behalf — every draft is reviewed and posted by you.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Tone"
              options={TONE_OPTIONS}
              value={config.tone}
              onChange={(event) => setConfig({ ...config, tone: event.target.value as Tone })}
            />
            <Input
              label="Language"
              value={config.language}
              maxLength={8}
              onChange={(event) => setConfig({ ...config, language: event.target.value })}
              hint="ISO code, e.g. en, de."
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-900">
              Max reply length — {config.max_reply_length} characters
            </label>
            <input
              type="range"
              min={50}
              max={5000}
              step={10}
              value={config.max_reply_length}
              onChange={(event) =>
                setConfig({ ...config, max_reply_length: Number(event.target.value) })
              }
              className="w-full accent-primary-600"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input
              type="checkbox"
              checked={config.include_personal_experience}
              onChange={(event) =>
                setConfig({ ...config, include_personal_experience: event.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
            />
            Include personal experience in replies
          </label>

          <Input
            label="Patterns to avoid"
            value={avoidPatternsText}
            onChange={(event) => setAvoidPatternsText(event.target.value)}
            hint='Comma-separated, e.g. "check out our product, buy now".'
          />

          <Textarea
            label="Example replies"
            rows={5}
            value={exampleRepliesText}
            onChange={(event) => setExampleRepliesText(event.target.value)}
            hint="One example per line — few-shot examples for the AI drafter."
          />

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
