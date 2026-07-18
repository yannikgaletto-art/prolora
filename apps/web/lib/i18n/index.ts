// i18n foundation (GOAL-RUN5 D7/T1): typed dictionaries for wizard chrome.
// GOAL-RUN7 adds semantic DE/EN/ES catalog copy and dictionaries for the new
// activation surfaces. Post language remains independently controlled by the
// workspace voice configuration. No locale-routing dependency is required.
import type { AppLocale } from '@prolora/shared';
import { de } from './de';
import { en } from './en';
import { es } from './es';

export const APP_LOCALES: AppLocale[] = ['de', 'en', 'es'];
export const LOCALE_COOKIE = 'prolora-locale';

/** Every wizard-chrome string. Adding a key here forces all three locales. */
export interface WizardDict {
  page_title: string;
  format_text: string;
  format_thread: string;
  format_carousel_pdf: string;
  format_image_text: string;
  format_poll: string;
  entry_button: string;
  entry_promise: string;
  step_of: string; // "{current}" / "{total}" placeholders
  back: string;
  continue_: string;
  auto_skipped: string;
  step1_title: string;
  step1_subtitle: string;
  step2_title: string;
  step2_subtitle: string;
  step3_title: string;
  step3_subtitle: string;
  step4_fill_title: string;
  step4_preview_title: string;
  when_to_pick: string;
  why_it_works: string;
  benchmark_label: string;
  benchmark_disclaimer: string;
  effort_label: string;
  effort_low: string;
  effort_medium: string;
  effort_high: string;
  frequency_label: string;
  prerequisites_label: string;
  cta_fill_with_credit: string;
  cta_fill_free: string;
  cost_line: string;
  cost_line_no_credits: string;
  regenerate_suggestions: string;
  prefill_loading: string;
  prefill_error: string;
  prefill_continue_without: string;
  ai_suggestion_badge: string;
  experience_hint: string;
  example_prefix: string;
  optional_suffix: string;
  generate_draft: string;
  generating_draft: string;
  scaffold_only: string;
  ai_disabled_reason: string;
  missing_slot_error: string;
  preview_first_comment: string;
  preview_platforms: string;
  preview_slides: string;
  preview_manual_steps: string;
  apply_to_composer: string;
  regenerate_draft: string;
  back_to_edit: string;
  mic_start: string;
  mic_stop: string;
  mic_blocked: string;
  mic_no_speech: string;
  mic_network_error: string;
  mic_privacy_notice: string;
  mic_privacy_dismiss: string;
  language_label: string;
  language_content_note: string;
  toast_applied: string;
  toast_expired: string;
  impact_title: string;
  impact_description: string;
  impact_check: string;
  impact_checking: string;
  impact_credit_hint: string;
  impact_green: string;
  impact_yellow: string;
  impact_red: string;
  impact_green_message: string;
  impact_yellow_message: string;
  impact_red_message: string;
  impact_retry: string;
  impact_no_platform: string;
  impact_empty: string;
  impact_fold_label: string;
  impact_more: string;
  impact_move_link: string;
  impact_link_context: string;
  impact_hook: string;
  impact_structure: string;
  impact_formatting: string;
  impact_hygiene: string;
  impact_improvements: string;
  impact_hook_rewrite: string;
  impact_apply: string;
  impact_variants_button: string;
  impact_variants_title: string;
  impact_variant_placeholder: string;
  impact_variant_compare: string;
  impact_variant_cost: string;
  impact_variant_original: string;
  impact_variant_score: string;
  impact_variant_use: string;
  impact_expectation: string;
  impact_linkedin_calibration: string;
  impact_accuracy_title: string;
  impact_accuracy_description: string;
  impact_accuracy_low_data: string;
  impact_accuracy_result: string;
  impact_accuracy_matrix: string;
  impact_bucket_below: string;
  impact_bucket_inline: string;
  impact_bucket_above: string;
  impact_bucket_outlier: string;
  creator_style_title: string;
  creator_style_description: string;
  creator_style_save: string;
  creator_style_saving: string;
  creator_style_saved: string;
  creator_style_error: string;
}

const DICTS: Record<AppLocale, WizardDict> = { de, en, es };

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return value === 'de' || value === 'en' || value === 'es';
}

/** Accept-Language → best supported locale (defaults to 'de' — DACH market). */
export function parseAcceptLanguage(header: string | null | undefined): AppLocale {
  if (!header) return 'de';
  for (const part of header.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isAppLocale(code)) return code;
  }
  return 'de';
}

export function getDict(locale: AppLocale): WizardDict {
  return DICTS[locale];
}

/** Tiny interpolation helper: fill("{current} / {total}", { current: 1 }) */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}
