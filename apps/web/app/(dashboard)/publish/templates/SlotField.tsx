'use client';

// One wizard slot (GOAL-RUN5 design spec): question → help line → textarea
// with a 44×44 mic → example / AI badge / error. Own component instead of
// Input.tsx because a slot shows help AND example AND (badge XOR error) at
// once — Input's single `hint` line can't express that.
import { useId } from 'react';
import type { TemplateSlot } from '@prolora/shared';
import type { WizardDict } from '@/lib/i18n';

export interface SlotFieldMic {
  supported: boolean;
  /** This slot is recording right now. */
  active: boolean;
  /** Permission denied — mic is replaced by an inline hint. */
  blocked: boolean;
  /** "Nichts erkannt" hint for this slot (last no-speech target). */
  noSpeechHint: boolean;
  onToggle: () => void;
}

export interface SlotFieldProps {
  slot: TemplateSlot;
  value: string;
  /** Effective required (catalog `required` minus context-covered prefills). */
  required: boolean;
  onChange: (value: string) => void;
  /** Value came from AI prefill and is untouched — shows the badge (O4). */
  aiSuggested: boolean;
  error?: string;
  dict: WizardDict;
  mic: SlotFieldMic;
  textareaRef?: (element: HTMLTextAreaElement | null) => void;
}

export function SlotField({
  slot,
  value,
  required,
  onChange,
  aiSuggested,
  error,
  dict,
  mic,
  textareaRef,
}: SlotFieldProps) {
  const fieldId = useId();
  const describedById = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-gray-900">
        {slot.question}
        {!required && <span className="font-normal text-gray-500"> {dict.optional_suffix}</span>}
      </label>
      <p className="text-xs text-gray-500">{slot.help}</p>

      <div className="flex items-start gap-2">
        <textarea
          id={fieldId}
          ref={textareaRef}
          // GOAL-RUN9 D6: 'story' slots collect long-form raw material — give
          // dictation room to breathe instead of a two-line strip.
          rows={slot.kind === 'story' ? 8 : 2}
          maxLength={slot.kind === 'story' ? 4000 : 500}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={slot.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedById}
          className={`block w-full flex-1 rounded-md border-0 px-3 py-2 text-sm text-gray-900 shadow-sm ring-1 ring-inset placeholder:text-gray-400 focus:ring-2 focus:ring-inset ${
            error
              ? 'ring-red-300 focus:ring-red-500'
              : 'ring-gray-300 focus:ring-primary-600'
          }`}
        />
        {mic.supported && !mic.blocked && (
          <button
            type="button"
            onClick={mic.onToggle}
            aria-pressed={mic.active}
            aria-label={mic.active ? dict.mic_stop : dict.mic_start}
            title={mic.active ? dict.mic_stop : dict.mic_start}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
              mic.active
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-white text-gray-500 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            {mic.active ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        )}
      </div>

      <div id={describedById} className="min-h-4 text-xs">
        {error ? (
          <p className="font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-gray-500">
            {aiSuggested && (
              <span className="mr-1.5 inline-flex items-center rounded-full bg-primary-50 px-1.5 py-0.5 text-[11px] font-medium text-primary-700 ring-1 ring-inset ring-primary-600/20">
                {dict.ai_suggestion_badge}
              </span>
            )}
            {dict.example_prefix} „{slot.example}“
          </p>
        )}
        {mic.blocked && <p className="mt-0.5 text-gray-500">{dict.mic_blocked}</p>}
        {!error && mic.noSpeechHint && <p className="mt-0.5 text-gray-500">{dict.mic_no_speech}</p>}
      </div>
    </div>
  );
}
