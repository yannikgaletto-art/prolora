// Guide layer for the template wizard (GOAL-RUN5 G0) — pure data + pure
// functions, no DB and no AI imports (Oracle O1). Deliberately does NOT import
// the catalog: client components pass stripped PostTemplateSummary arrays, so
// prompt_hints never enter the client bundle (Oracle O3); server code and
// tests pass TEMPLATE_CATALOG. German by design — DACH product content; only
// the wizard CHROME is trilingual (lib/i18n). Outcome copy rule (Pass 3):
// labels name the RESULT the user wants, never our internal taxonomy.
import type { TemplateIntent } from '@prolora/shared';

/** Minimal template shape the guide needs — Summary and full catalog both fit. */
export interface GuideTemplate {
  id: string;
  intent: TemplateIntent;
  anlass_keys: string[];
}

export interface IntentInfo {
  key: TemplateIntent;
  /** Outcome language — what the user gets, not what we call it. */
  label: string;
  satz: string;
  /** Exactly three: Strategie / Vorteil / typisches Ergebnis (Feedback #3). */
  bullets: [string, string, string];
  wann: string;
}

export const INTENT_INFO: IntentInfo[] = [
  {
    key: 'value',
    label: 'Werde als Experte sichtbar',
    satz: 'Teile Wissen, das man speichert und weiterschickt.',
    bullets: [
      'Strategie: Du verschenkst echtes Know-how — Listen, Anleitungen, Playbooks — ohne Gegenleistung im Post.',
      'Vorteil: Save-würdige Posts arbeiten wochenlang für dich und bauen Autorität auf, bevor du je pitchst.',
      'Typisches Ergebnis: mehr Profilbesuche, Follower mit echtem Interesse, „Woher weißt du das?"-Kommentare.',
    ],
    wann: 'Wähle das, wenn du regelmäßig posten willst, ohne dich anzupreisen — die Grundlage für alles andere.',
  },
  {
    key: 'product',
    label: 'Zeig, was dein Produkt kann',
    satz: 'Demonstriere das Ergebnis — nicht die Feature-Liste.',
    bullets: [
      'Strategie: Ein konkreter Anwendungsfall mit Zahl („spart mir 2 Stunden") — das Produkt ist Werkzeug, nie Held.',
      'Vorteil: Ergebnis-Demos wirken wie Empfehlungen, nicht wie Werbung — und überleben den Algorithmus-Filter.',
      'Typisches Ergebnis: qualifizierte Nachfragen („Wie hast du das gebaut?") statt leerer Likes.',
    ],
    wann: 'Wähle das, wenn es ein fertiges Feature, einen Workflow oder ein messbares Ergebnis zu zeigen gibt.',
  },
  {
    key: 'community',
    label: 'Bring Leute in deine Community',
    satz: 'Mach sichtbar, was drinnen passiert — und öffne die Tür.',
    bullets: [
      'Strategie: Fremde Erfolge und echte Entscheidungen aus der Community zeigen — Beweis statt Versprechen.',
      'Vorteil: Comment-Trigger („Kommentiere LIVE") senken die Beitritts-Hürde auf einen einzigen Kommentar.',
      'Typisches Ergebnis: Beitritts-Anfragen von Leuten, die schon wissen, was sie drinnen erwartet.',
    ],
    wann: 'Wähle das, wenn du bereits eine Community (Skool, Discord, Gruppe) hast, die wachsen soll.',
  },
  {
    key: 'social_proof',
    label: 'Beweise, dass es funktioniert',
    satz: 'Vorher/Nachher und ehrliche Erfahrungen — Zahlen statt Behauptungen.',
    bullets: [
      'Strategie: Transformation mit echten Zahlen oder ein ehrliches Fazit mit Stärken UND Schwächen.',
      'Vorteil: Ehrlichkeit (auch über Minuspunkte) ist der stärkste Glaubwürdigkeits-Hebel überhaupt.',
      'Typisches Ergebnis: Vertrauen, das spätere Produkt-Posts erst wirksam macht.',
    ],
    wann: 'Wähle das, wenn du ein messbares Ergebnis oder eine echte Test-Erfahrung vorweisen kannst.',
  },
  {
    key: 'personal_brand',
    label: 'Bau deine persönliche Marke',
    satz: 'Zeig den Weg — ungefiltert, in Serie, mit Wiedererkennung.',
    bullets: [
      'Strategie: Build-in-public — Fortschritte, Fails und Alltag dokumentieren statt inszenieren.',
      'Vorteil: Serien („Tag 12 von …") erzeugen einen Follow-Grund; Ungefiltertes schlägt Poliertes.',
      'Typisches Ergebnis: Leute folgen DIR, nicht nur dem Produkt — das übersteht jeden Pivot.',
    ],
    wann: 'Wähle das, wenn du kontinuierlich sichtbar sein willst, auch ohne fertiges Ergebnis.',
  },
];

export interface AnlassInfo {
  key: string;
  label: string;
  beschreibung: string;
  beispiel: string;
}

// „Was hast du gerade zur Hand?" — the second wizard level. Templates declare
// their anlass_keys explicitly in the catalog (curation, GOAL-RUN5 T2).
export const ANLASS_INFO: AnlassInfo[] = [
  {
    key: 'zahl',
    label: 'Eine Zahl / ein Ergebnis',
    beschreibung: 'Etwas ist messbar besser geworden — Zeit, Geld, Reichweite, Umsatz.',
    beispiel: '„Von 6 Std auf 20 Min pro Woche."',
  },
  {
    key: 'wip',
    label: 'Screenshot / Fehler / Zwischenstand',
    beschreibung: 'Etwas aus dem Maschinenraum — auch (gerade!) wenn es noch nicht fertig ist.',
    beispiel: 'Terminal-Fehler, halbfertiges Feature, Dashboard von heute.',
  },
  {
    key: 'feature',
    label: 'Fertiges Feature / Workflow',
    beschreibung: 'Etwas funktioniert und lässt sich zeigen oder Schritt für Schritt erklären.',
    beispiel: 'Eine Automation, ein Setup, ein neuer Ablauf.',
  },
  {
    key: 'meinung',
    label: 'Eine Erfahrung mit einem Tool',
    beschreibung: 'Du hast etwas lange genug benutzt, um ehrlich Stärken und Schwächen zu nennen.',
    beispiel: '„30 Tage Notion AI — mein Fazit."',
  },
  {
    key: 'neu',
    label: 'Etwas Neues ist angekommen',
    beschreibung: 'Gerät, Tool oder Zugang ist frisch da — der erste Eindruck zählt nur einmal.',
    beispiel: 'Neues Tool-Abo, Hardware, Beta-Zugang.',
  },
  {
    key: 'community',
    label: 'Ein Mitglieder-Erfolg',
    beschreibung: 'Jemand aus deiner Community hat etwas erreicht (Screenshot + Einwilligung!).',
    beispiel: '„Lena hat ihre erste Automation verkauft."',
  },
  {
    key: 'frage',
    label: 'Eine offene Entscheidung',
    beschreibung: 'Du stehst wirklich vor einer Wahl — lass deine Leser mitentscheiden.',
    beispiel: '„Welches Problem soll ich zuerst lösen: A, B oder C?"',
  },
  {
    key: 'nichts',
    label: 'Nichts Konkretes',
    beschreibung: 'Kein Anlass nötig — Wissen und Alltag reichen völlig.',
    beispiel: 'Eine Liste, ein Setup-Post, ein Learning.',
  },
];

export function anlassByKey(key: string): AnlassInfo | undefined {
  return ANLASS_INFO.find((a) => a.key === key);
}

export function intentByKey(key: string): IntentInfo | undefined {
  return INTENT_INFO.find((i) => i.key === key);
}

export function templatesFor<T extends GuideTemplate>(
  templates: T[],
  intent: TemplateIntent,
  anlassKey?: string
): T[] {
  return templates.filter(
    (t) => t.intent === intent && (!anlassKey || t.anlass_keys.includes(anlassKey))
  );
}

/** Anlässe offered for a goal — only those with ≥ 1 template (Oracle O6). */
export function anlaesseForGoal(templates: GuideTemplate[], intent: TemplateIntent): AnlassInfo[] {
  return ANLASS_INFO.filter((a) => templatesFor(templates, intent, a.key).length > 0);
}

/**
 * Adaptive step plan (GOAL-RUN5 T2/V4.8): steps without a real choice are
 * auto-skipped. The caller navigates skipped steps with replaceState so the
 * browser Back button never bounces.
 */
export interface StepPlan {
  /** Skip the Anlass step entirely (exactly one anlass for this goal). */
  skipAnlass: boolean;
  /** The single anlass key when skipAnlass is true. */
  soleAnlassKey?: string;
  /** Auto-expand the single template (no template choice on step 3). */
  autoExpandTemplateId?: string;
}

export function stepPlanFor(
  templates: GuideTemplate[],
  intent: TemplateIntent,
  anlassKey?: string
): StepPlan {
  const anlaesse = anlaesseForGoal(templates, intent);
  const skipAnlass = anlaesse.length === 1;
  const soleAnlassKey = skipAnlass ? anlaesse[0]?.key : undefined;
  const effectiveAnlass = soleAnlassKey ?? anlassKey;
  const matching = effectiveAnlass ? templatesFor(templates, intent, effectiveAnlass) : [];
  return {
    skipAnlass,
    soleAnlassKey,
    autoExpandTemplateId: matching.length === 1 ? matching[0]?.id : undefined,
  };
}

/**
 * Guide invariants, executable (verschärftes O6 — used by guide.test.ts):
 *  - every offered (goal × anlass) combination yields ≥ 1 template
 *  - no two anlässe of one goal yield the identical template set (Scheinentscheidung)
 *  - every goal has ≥ 2 real paths
 * Returns human-readable violations; empty array = healthy catalog.
 */
export function guideInvariantViolations(templates: GuideTemplate[]): string[] {
  const violations: string[] = [];
  for (const intent of INTENT_INFO) {
    const anlaesse = anlaesseForGoal(templates, intent.key);
    if (anlaesse.length < 2) {
      violations.push(`Ziel "${intent.key}" hat nur ${anlaesse.length} echten Weg(e).`);
    }
    const seenSets = new Map<string, string>();
    for (const anlass of anlaesse) {
      const ids = templatesFor(templates, intent.key, anlass.key)
        .map((t) => t.id)
        .sort()
        .join(',');
      if (ids.length === 0) {
        violations.push(`Kombination ${intent.key} × ${anlass.key} hat kein Template.`);
      }
      const duplicate = seenSets.get(ids);
      if (duplicate) {
        violations.push(
          `Scheinentscheidung: ${intent.key} × ${anlass.key} und × ${duplicate} führen zur identischen Menge [${ids}].`
        );
      }
      seenSets.set(ids, anlass.key);
    }
  }
  const knownKeys = new Set(ANLASS_INFO.map((a) => a.key));
  for (const template of templates) {
    if (template.anlass_keys.length === 0) {
      violations.push(`Template "${template.id}" hat keine anlass_keys.`);
    }
    for (const key of template.anlass_keys) {
      if (!knownKeys.has(key)) {
        violations.push(`Template "${template.id}" nutzt unbekannten Anlass "${key}".`);
      }
    }
  }
  return violations;
}
