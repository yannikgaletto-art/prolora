// 0-credit scaffold mode (GOAL-RUN4 T1-2): deterministic string assembly, no
// AI import anywhere in this path (Oracle 8) — works on the starter plan and
// without ANTHROPIC_API_KEY.
import type { PostTemplate } from '@prolora/shared';

const CTA_SCAFFOLD: Record<PostTemplate['cta_mechanic'], string> = {
  comment_trigger: 'Kommentiere [WORT] und ich schicke dir [Asset] per DM.',
  save_cta: 'Speichere den Post für [konkreter Anlass].',
  link_in_comment: '[Link kommt in den ersten Kommentar]',
  poll: 'Stimme ab: A) [Option] B) [Option] C) [Option] — anderes in die Kommentare.',
  dm_invite: 'Schreib mir [WORT] direkt.',
  none: '[Offene Frage an die Leser]',
};

function humanizeSlotKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Fills the first hook formula with matching slot values ([key] tokens) and
// lays out the remaining script slots as labelled, editable placeholders.
export function renderScaffold(template: PostTemplate, slots: Record<string, string>): string {
  let hook = template.hook_formulas[0] ?? '';
  for (const [key, value] of Object.entries(slots)) {
    if (!value.trim()) continue;
    hook = hook.split(`[${key}]`).join(value.trim());
  }

  const answered = Object.entries(slots)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${humanizeSlotKey(key)}: ${value.trim()}`);

  const structureLines = template.structure
    .filter((slot) => !/hook|cta|caption|overlay/.test(slot))
    .map((slot) => `[${humanizeSlotKey(slot)}: …]`);

  return [
    hook,
    '',
    ...structureLines,
    '',
    CTA_SCAFFOLD[template.cta_mechanic],
    ...(answered.length > 0 ? ['', '---', 'Deine Angaben:', ...answered.map((a) => `- ${a}`)] : []),
  ].join('\n');
}
