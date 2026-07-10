'use client';

// Template gallery + slot wizard (GOAL-RUN4 T2-1/T2-2). Two steps inside one
// modal: filter the catalog (intent + "what do you have at hand"), then answer
// the template's slot questions and insert either the free scaffold or the
// AI draft into the composer. UI chrome is English (house convention); the
// catalog data (names, questions, hooks) is German by design.
import { useMemo, useState } from 'react';
import type {
  PlatformType,
  PostTemplateSummary,
  TemplateDraftResponse,
  TemplateIntent,
  TemplateListResponse,
} from '@prolora/shared';
import { Badge } from '@/app/components/Badge';
import { Button } from '@/app/components/Button';
import { Modal } from '@/app/components/Modal';
import { Textarea } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { ConnectionWithLimit } from '@/lib/connections/list-connections';
import { ASSET_TO_POST_TYPES } from '@/lib/templates/filter';
import { PLATFORM_META } from './platform-meta';

const INTENT_CHIPS: { key: TemplateIntent; label: string }[] = [
  { key: 'value', label: 'Build authority' },
  { key: 'product', label: 'Show product' },
  { key: 'community', label: 'Grow community' },
  { key: 'social_proof', label: 'Social proof' },
  { key: 'personal_brand', label: 'Personal brand' },
];

const FORMAT_LABELS: Record<PostTemplateSummary['format'], string> = {
  text: 'Text',
  thread: 'Thread',
  carousel_pdf: 'PDF carousel',
  image_text: 'Image + text',
  poll: 'Poll',
};

export interface AppliedTemplate {
  content: string;
  firstComment?: string;
  /** Connection ids to preselect (recommended ∩ connected ∩ active). */
  connectionIds: string[];
  extras: {
    templateName: string;
    slides?: string[];
    manualSteps?: string[];
  } | null;
}

export function TemplatePicker({
  connections,
  onApply,
}: {
  connections: ConnectionWithLimit[];
  onApply: (result: AppliedTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TemplateListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [intent, setIntent] = useState<TemplateIntent | 'all'>('all');
  const [asset, setAsset] = useState<string>('all');
  const [selected, setSelected] = useState<PostTemplateSummary | null>(null);
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [slotError, setSlotError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<'scaffold' | 'ai' | null>(null);

  const connectedPlatforms = useMemo(
    () => new Set(connections.filter((c) => c.status === 'active').map((c) => c.platform)),
    [connections]
  );

  async function openPicker() {
    setOpen(true);
    setSelected(null);
    if (data) return;
    try {
      const response = await fetchApi<TemplateListResponse>('/v1/templates');
      setData(response);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }

  const visibleTemplates = useMemo(() => {
    if (!data) return [];
    const assetEntry = ASSET_TO_POST_TYPES.find((a) => a.key === asset);
    return data.templates.filter((template) => {
      if (intent !== 'all' && template.intent !== intent) return false;
      if (assetEntry && !assetEntry.postTypes.includes(template.post_type)) return false;
      return true;
    });
  }, [data, intent, asset]);

  function pickTemplate(template: PostTemplateSummary) {
    setSelected(template);
    setSlotValues({});
    setSlotError(null);
  }

  function isEffectivelyRequired(slot: PostTemplateSummary['slots'][number]): boolean {
    return slot.required && !(slot.prefill_from && data?.context_available);
  }

  async function submit(mode: 'scaffold' | 'ai') {
    if (!selected || !data) return;
    setSlotError(null);

    const missing = selected.slots.find(
      (slot) => isEffectivelyRequired(slot) && !slotValues[slot.key]?.trim()
    );
    if (missing) {
      setSlotError(`Please answer: "${missing.question}"`);
      return;
    }

    const recommendedConnected = selected.recommended_platforms.filter((p) =>
      connectedPlatforms.has(p)
    );
    const targetPlatforms: PlatformType[] =
      recommendedConnected.length > 0 ? recommendedConnected : selected.recommended_platforms;

    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(slotValues)) {
      if (value.trim()) slots[key] = value.trim();
    }

    setGenerating(mode);
    try {
      const response = await fetchApi<TemplateDraftResponse>('/v1/templates/draft', {
        method: 'POST',
        body: JSON.stringify({
          template_id: selected.id,
          slots,
          target_platforms: targetPlatforms,
          mode,
        }),
      });

      const activeRecommendedIds = connections
        .filter(
          (c) =>
            c.status === 'active' &&
            response.draft.recommended_platforms.includes(c.platform)
        )
        .map((c) => c.connection_id);

      const hasExtras =
        (response.draft.slides?.length ?? 0) > 0 || (response.draft.manual_steps?.length ?? 0) > 0;

      onApply({
        content: response.draft.content,
        firstComment: response.draft.first_comment,
        connectionIds: activeRecommendedIds,
        extras: hasExtras
          ? {
              templateName: selected.name,
              slides: response.draft.slides,
              manualSteps: response.draft.manual_steps,
            }
          : null,
      });
      setOpen(false);
      setSelected(null);
      setSlotValues({});
    } catch (error) {
      setSlotError(errorMessage(error));
    } finally {
      setGenerating(null);
    }
  }

  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? 'border-primary-300 bg-primary-50 text-primary-700'
        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
    }`;

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={openPicker}>
        Use a template
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={selected ? selected.name : 'Post templates'}
        description={
          selected
            ? selected.description
            : 'Pick a recipe — hooks, structure and CTA mechanics are built in.'
        }
      >
        {!selected ? (
          <div className="flex flex-col gap-4">
            {loadError && <p className="text-sm text-red-600">{loadError}</p>}
            {!data && !loadError && <p className="text-sm text-gray-500">Loading templates…</p>}
            {data && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={chipClass(intent === 'all')} onClick={() => setIntent('all')}>
                    All goals
                  </button>
                  {INTENT_CHIPS.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      className={chipClass(intent === chip.key)}
                      onClick={() => setIntent(intent === chip.key ? 'all' : chip.key)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={chipClass(asset === 'all')} onClick={() => setAsset('all')}>
                    Anything
                  </button>
                  {ASSET_TO_POST_TYPES.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className={chipClass(asset === entry.key)}
                      onClick={() => setAsset(asset === entry.key ? 'all' : entry.key)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                  {visibleTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => pickTemplate(template)}
                      className="rounded-md border border-gray-200 px-3 py-2.5 text-left hover:border-primary-300 hover:bg-primary-50/40"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900">{template.name}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {template.recommended_platforms.map((platform) => (
                            <span
                              key={platform}
                              aria-hidden="true"
                              title={PLATFORM_META[platform].label}
                              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                              style={{ backgroundColor: PLATFORM_META[platform].color }}
                            >
                              {PLATFORM_META[platform].initial}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-gray-500">{template.description}</span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <Badge tone="gray">{FORMAT_LABELS[template.format]}</Badge>
                        {template.manual_steps && template.manual_steps.length > 0 && (
                          <Badge tone="amber">Manual steps</Badge>
                        )}
                      </span>
                    </button>
                  ))}
                  {visibleTemplates.length === 0 && (
                    <p className="py-6 text-center text-sm text-gray-500">
                      No template matches these filters — try loosening them.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="self-start text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              ← Back to templates
            </button>

            {selected.slots.map((slot) => (
              <Textarea
                key={slot.key}
                name={`slot-${slot.key}`}
                rows={2}
                label={`${slot.question}${isEffectivelyRequired(slot) ? '' : ' (optional)'}`}
                placeholder={slot.placeholder}
                value={slotValues[slot.key] ?? ''}
                onChange={(event) =>
                  setSlotValues((current) => ({ ...current, [slot.key]: event.target.value }))
                }
                hint={
                  slot.prefill_from && data?.context_available
                    ? 'Auto-filled from your workspace context if left empty.'
                    : slot.prefill_from && data && !data.context_available
                      ? 'Tip: set up Auto-Context under Discover to auto-fill this.'
                      : undefined
                }
              />
            ))}

            {slotError && <p className="text-sm text-red-600">{slotError}</p>}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={generating === 'scaffold'}
                disabled={generating !== null}
                onClick={() => submit('scaffold')}
              >
                Insert scaffold (0 credits)
              </Button>
              <Button
                type="button"
                loading={generating === 'ai'}
                disabled={generating !== null || data?.ai_enabled === false}
                title={
                  data?.ai_enabled === false
                    ? 'AI drafts need AI credits — available on Pro and Agency plans.'
                    : undefined
                }
                onClick={() => submit('ai')}
              >
                Generate with AI (1 credit)
              </Button>
            </div>
            {data?.ai_enabled === false && (
              <p className="text-right text-xs text-gray-500">
                AI drafting needs AI credits (Pro: 100/month). The scaffold is free.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
