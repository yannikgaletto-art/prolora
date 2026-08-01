'use client';

// Content Hub (GOAL-RUN6 §12) — the splintering flywheel, human-in-the-loop:
// pillar (typed / dictated / imported) -> splinter suggestions with honest
// framework labels (PIA + 4A) -> each suggestion becomes a normal draft in
// the calendar or is handed to the composer. Nothing auto-publishes.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlatformType, SplinterSuggestion } from '@prolora/shared';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Input } from '@/app/components/Input';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { storeAppliedTemplate } from '../handoff';
import { useSpeechInput } from '../templates/useSpeechInput';
import type { FeatureState } from '@/lib/system/doctor';
import { GenerationPreflight, type PreflightLanguage, type PreflightMention } from '../writer/GenerationPreflight';

export interface HubConnection {
  id: string;
  platform: PlatformType;
  account_name: string;
}

interface SourceDto {
  id: string;
  kind: string;
  title: string | null;
  status: string;
  body_preview: string;
  body_chars: number;
  splinter_count: number;
  created_at: string;
}

interface SplinterResponse {
  source_id: string;
  core_ideas: string[];
  suggestions: SplinterSuggestion[];
  warnings: string[];
  credits_used: number;
}

const FRAMEWORK_LABELS: Record<SplinterSuggestion['framework_4a'], string> = {
  actionable: '4A · Aktionabel',
  analytical: '4A · Analytisch',
  aspirational: '4A · Aspirational',
  anthropological: '4A · Anthropologisch',
};

const PLATFORM_LABELS: Record<PlatformType, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  telegram: 'Telegram',
  discord: 'Discord',
  devto: 'Dev.to',
  hashnode: 'Hashnode',
};

export function HubView({ connections, aiState }: { connections: HubConnection[]; aiState: FeatureState }) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Pillar form
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Dictation (existing GOAL-RUN5 hook — browser-native, no server audio).
  const speech = useSpeechInput('de');
  const dictating = speech.activeKey === 'pillar';

  // Splinter state
  const [activeSource, setActiveSource] = useState<SourceDto | null>(null);
  const [splintering, setSplintering] = useState(false);
  const [result, setResult] = useState<SplinterResponse | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<Set<number>>(new Set());
  const [savingDraft, setSavingDraft] = useState<number | null>(null);
  const [scoringDraft, setScoringDraft] = useState<number | null>(null);
  const [checksByDraft, setChecksByDraft] = useState<Record<number, { formatting_score: number; platform_hygiene_score: number }>>({});
  const [impactByDraft, setImpactByDraft] = useState<Record<number, number>>({});
  const [outputLanguage, setOutputLanguage] = useState<PreflightLanguage>('de');
  const [mentionMode, setMentionMode] = useState<PreflightMention>('adaptive');

  function connectionsFor(platform: PlatformType): HubConnection[] {
    return connections.filter((c) => c.platform === platform);
  }

  async function savePillar(): Promise<SourceDto | null> {
    setSaving(true);
    setFormError(null);
    try {
      const { source } = await fetchApi<{ source: SourceDto }>('/v1/content/sources', {
        method: 'POST',
        body: JSON.stringify({ kind: 'paste', title: title.trim() || undefined, body_md: body }),
      });
      setActiveSource(source);
      return source;
    } catch (error) {
      setFormError(errorMessage(error));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function importFromUrl() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setFormError(null);
    try {
      const { source } = await fetchApi<{ source: SourceDto }>('/v1/content/sources', {
        method: 'POST',
        body: JSON.stringify({ kind: 'url', url: importUrl.trim(), title: title.trim() || undefined }),
      });
      setActiveSource(source);
      setTitle(source.title ?? '');
      setBody(source.body_preview.endsWith('…') ? '' : source.body_preview);
      setToast({ variant: 'success', message: `Importiert: ${source.body_chars} Zeichen.` });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setImporting(false);
    }
  }

  async function runSplinter() {
    if (aiState.state !== 'ready') {
      setFormError(aiState.hint ?? 'AI splintering is not available yet.');
      return;
    }
    setSplintering(true);
    setFormError(null);
    setResult(null);
    setSavedDrafts(new Set());
    try {
      // Save the pillar first (unless a URL import already created it).
      const source = activeSource && body.trim() === '' ? activeSource : await savePillar();
      if (!source) return;
      const res = await fetchApi<SplinterResponse>(`/v1/content/sources/${source.id}/splinter`, {
        method: 'POST',
        body: JSON.stringify({ output_language: outputLanguage, product_mention_mode: mentionMode }),
      });
      setResult(res);
      setToast({
        variant: 'success',
        message: `${res.suggestions.length} Splinter aus ${res.core_ideas.length} Kernideen (−${res.credits_used} Credits).`,
      });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSplintering(false);
    }
  }

  async function saveAsDraft(suggestion: SplinterSuggestion, index: number) {
    const targets = connectionsFor(suggestion.platform);
    if (targets.length === 0) return;
    setSavingDraft(index);
    try {
      const accepted = await fetchApi<{
        checks: { formatting_score: number; platform_hygiene_score: number };
      }>('/v1/content/splinters/accept', {
        method: 'POST',
        body: JSON.stringify({
          connection_id: targets[0].id,
          platform: suggestion.platform,
          content: suggestion.content,
          first_comment: suggestion.first_comment,
        }),
      });
      setChecksByDraft((current) => ({ ...current, [index]: accepted.checks }));
      setSavedDrafts((prev) => new Set(prev).add(index));
      setToast({ variant: 'success', message: 'Angenommen, kostenlos geprüft und am nächsten freien Slot eingeplant.' });
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setSavingDraft(null);
    }
  }

  async function scoreSuggestion(suggestion: SplinterSuggestion, index: number) {
    const target = connectionsFor(suggestion.platform)[0];
    if (!target) return;
    setScoringDraft(index);
    try {
      const result = await fetchApi<{ virality_score: number }>('/v1/posts/score', {
        method: 'POST',
        body: JSON.stringify({
          content: suggestion.content,
          platform: suggestion.platform,
          first_comment: suggestion.first_comment,
          connection_id: target.id,
        }),
      });
      setImpactByDraft((current) => ({ ...current, [index]: result.virality_score }));
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setScoringDraft(null);
    }
  }

  function openInComposer(suggestion: SplinterSuggestion) {
    const targets = connectionsFor(suggestion.platform);
    storeAppliedTemplate(
      {
        content: suggestion.content,
        firstComment: suggestion.first_comment,
        connectionIds: targets.map((c) => c.id),
        extras: {
          templateName: `Splinter · ${suggestion.format_label}`,
          slides: suggestion.slides,
        },
      },
      Date.now()
    );
    router.push('/publish');
  }

  return (
    <div className="space-y-6">
      <GenerationPreflight language={outputLanguage} mention={mentionMode} allowBoth={false} disabled={splintering} onLanguageChange={setOutputLanguage} onMentionChange={setMentionMode} />
      <Card>
        <h2 className="text-sm font-semibold text-gray-900">Pillar-Content</h2>
        <p className="mt-1 text-xs text-gray-500">
          Ein langer Gedanke (Newsletter, Blogpost, Braindump) wird zu 3 Kernideen und mehreren
          strukturell verschiedenen Posts (1-3-5-Methode). Frameworks werden transparent gelabelt.
        </p>

        <div className="mt-4 space-y-3">
          <Input
            label="Titel (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z. B. Warum wir Prolora ohne Auto-Posting bauen"
          />
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="pillar-body" className="block text-sm font-medium text-gray-700">
                Text
              </label>
              {speech.supported && !speech.blocked && (
                <button
                  type="button"
                  onClick={() =>
                    dictating ? speech.stop() : speech.start('pillar', (t) => setBody((b) => (b ? `${b} ${t}` : t)))
                  }
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    dictating ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {dictating ? '● Aufnahme läuft — stoppen (Esc)' : '🎙 Diktieren'}
                </button>
              )}
            </div>
            <textarea
              id="pillar-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Schreibe oder diktiere deinen Long-Form-Gedanken (min. 200 Zeichen)…"
            />
            <p className="mt-1 text-right text-xs text-gray-400">{body.length} Zeichen</p>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Oder Blog-URL importieren"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://dein-blog.de/post"
              />
            </div>
            <Button variant="secondary" onClick={importFromUrl} loading={importing}>
              Importieren
            </Button>
          </div>

          {speech.transientError && (
            <p className="text-xs text-amber-600">
              {speech.transientError === 'no-speech' ? 'Keine Sprache erkannt.' : 'Netzwerkproblem bei der Erkennung.'}
              <button type="button" className="ml-2 underline" onClick={speech.dismissError}>
                OK
              </button>
            </p>
          )}
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          {aiState.state !== 'ready' && !formError && (
            <p className="text-sm text-amber-700">{aiState.hint ?? 'AI splintering needs setup or available credits.'}</p>
          )}

          <div className="flex justify-end">
            <Button onClick={runSplinter} loading={splintering || saving} disabled={aiState.state !== 'ready' || (body.trim().length < 200 && !activeSource)}>
              In Posts splittern
            </Button>
          </div>
        </div>
      </Card>

      {result && (
        <>
          <Card>
            <h3 className="text-sm font-semibold text-gray-900">Kernideen</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
              {result.core_ideas.map((idea, i) => (
                <li key={i}>{idea}</li>
              ))}
            </ol>
            {result.warnings.length > 0 && (
              <p className="mt-2 text-xs text-amber-600">{result.warnings.join(' ')}</p>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {result.suggestions.map((s, index) => {
              const targets = connectionsFor(s.platform);
              const saved = savedDrafts.has(index);
              return (
                <Card key={index}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-gray-900 px-2 py-0.5 font-medium text-white">
                      {PLATFORM_LABELS[s.platform]}
                    </span>
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700">
                      {s.format_label}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                      {FRAMEWORK_LABELS[s.framework_4a]}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                      Idee {s.core_idea_index + 1}
                    </span>
                  </div>

                  <p className="mt-3 text-sm font-semibold text-gray-900">{s.hook}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{s.content}</p>

                  {s.slides && s.slides.length > 0 && (
                    <details className="mt-2 text-xs text-gray-600">
                      <summary className="cursor-pointer font-medium">Slides ({s.slides.length})</summary>
                      <ol className="mt-1 list-decimal space-y-1 pl-5">
                        {s.slides.map((slide, i) => (
                          <li key={i}>{slide}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {s.first_comment && (
                    <p className="mt-2 text-xs text-gray-500">Erster Kommentar: {s.first_comment}</p>
                  )}
                  {s.pia_note && (
                    <p className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500" title="Pain → Insight → Action">
                      PIA: {s.pia_note}
                    </p>
                  )}
                  {checksByDraft[index] && (
                    <p className="mt-2 text-xs text-green-700">
                      Gratis-Checks: Format {checksByDraft[index].formatting_score}/20 · Hygiene {checksByDraft[index].platform_hygiene_score}/20
                    </p>
                  )}
                  {impactByDraft[index] !== undefined && (
                    <p className="mt-1 text-xs font-medium text-primary-700">Impact-Score: {impactByDraft[index]}/100</p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                    {targets.length > 0 ? (
                      <Button
                        size="sm"
                        onClick={() => saveAsDraft(s, index)}
                        loading={savingDraft === index}
                        disabled={saved}
                      >
                        {saved ? '✓ Eingeplant' : 'Annehmen & einplanen'}
                      </Button>
                    ) : (
                      <span className="text-xs text-gray-400">
                        Kein aktiver {PLATFORM_LABELS[s.platform]}-Account verbunden
                      </span>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => openInComposer(s)}>
                      In Composer öffnen
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => scoreSuggestion(s, index)} loading={scoringDraft === index}>
                      Voller Impact-Score · 1 Credit
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
