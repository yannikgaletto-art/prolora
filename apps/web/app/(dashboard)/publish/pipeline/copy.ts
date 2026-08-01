// Copy für das Tages-Cockpit (Plan 2 / 2B.5), DE/EN/ES.
//
// Warum hier und nicht in lib/i18n/: Plan 2 lässt zwei Agenten parallel im
// selben Arbeitsbaum laufen und lib/i18n/index.ts gehört in diesem Lauf keinem
// von beiden — eine gemeinsame Datei anzufassen wäre genau der Merge-Konflikt,
// den die Dateibesitz-Tabelle verhindern soll. Muster und Typdisziplin folgen
// lib/i18n/product.ts: eine in sich geschlossene Datei, alle drei Sprachen,
// getippte Schlüssel. Beim Zusammenführen kann sie nach lib/i18n/ wandern.
import type { AppLocale } from '@prolora/shared';
import type { GateCheck, GateRemedy } from '@/lib/pipeline/quality-gate';
import type { ContentItemState } from '@/lib/pipeline/state';

export interface PipelineCopy {
  title: string;
  subtitle: string;
  today_headline: string;
  count_scheduled: string;
  count_in_gate: string;
  count_needs_proof: string;
  count_blocked: string;
  count_stalled: string;
  coverage_label: string;
  coverage_days: string;
  coverage_unknown: string;
  coverage_warning: string;
  run_button: string;
  running: string;
  estimate_title: string;
  estimate_line: string;
  estimate_saved: string;
  schedule_button: string;
  scheduling: string;
  gate_button: string;
  gate_running: string;
  gate_title: string;
  gate_passed: string;
  gate_blocked: string;
  gate_skipped_note: string;
  gate_stats_title: string;
  gate_stats_line: string;
  gate_stats_hint: string;
  override_button: string;
  override_title: string;
  override_placeholder: string;
  override_hint: string;
  override_confirm: string;
  override_cancel: string;
  override_done: string;
  provenance_title: string;
  provenance_empty: string;
  variants_title: string;
  variant_overridden: string;
  empty_title: string;
  empty_description: string;
  error_generic: string;
  states: Record<ContentItemState, string>;
  checks: Record<GateCheck, string>;
  remedies: Record<Exclude<GateRemedy, null>, string>;
  mix: Record<'insight' | 'proof' | 'story' | 'question', string>;
  evidence: Record<'feedback' | 'proof' | 'community' | 'reference', string>;
}

const de: PipelineCopy = {
  title: 'Content-Fabrik',
  subtitle:
    'Aus Signalen werden belegte, kanal-native Posts. Was das Gate nicht besteht, wird nicht veröffentlicht.',
  today_headline: 'Heute',
  count_scheduled: 'geplant',
  count_in_gate: 'im Gate',
  count_needs_proof: 'braucht Proof',
  count_blocked: 'blockiert',
  count_stalled: 'hängengeblieben',
  coverage_label: 'Reichweite',
  coverage_days: '{days} Tage Stoff',
  coverage_unknown: 'Reichweite unbekannt',
  coverage_warning: 'Unter 3 Tagen — neue Signale holen, bevor die Kadenz einbricht.',
  run_button: 'Fabrik einen Schritt weiterfahren',
  running: 'Läuft …',
  estimate_title: 'Kostenschätzung vor dem Lauf',
  estimate_line:
    '{items} Werkstück(e) × {channels} Kanäle = {calls} Aufruf(e), ca. {credits} Credits.',
  estimate_saved: 'Batching spart {saved} Credits gegenüber einem Aufruf je Kanal.',
  schedule_button: 'Nach Mix einplanen',
  scheduling: 'Plane ein …',
  gate_button: 'Gate prüfen',
  gate_running: 'Prüfe …',
  gate_title: 'Gate-Ergebnis',
  gate_passed: 'bestanden',
  gate_blocked: 'blockiert',
  gate_skipped_note: 'übersprungen — diese Prüfung hat nicht stattgefunden',
  gate_stats_title: 'Gate-Statistik',
  gate_stats_line: '{passed} bestanden, {blocked} blockiert, {overridden} übersteuert',
  gate_stats_hint:
    'Blockiert das Gate fast alles, sind die Schwellen zu eng — nicht die Entwürfe zu schlecht.',
  override_button: 'Übersteuern',
  override_title: 'Gate übersteuern',
  override_placeholder: 'Warum darf dieser Entwurf trotz Befund raus? (wird protokolliert)',
  override_hint:
    'Übersteuern wird mit deinem Namen, Zeitstempel und Grund festgehalten. Ohne Protokoll wäre das Gate nur eine Bitte.',
  override_confirm: 'Übersteuern und protokollieren',
  override_cancel: 'Abbrechen',
  override_done: 'Übersteuern protokolliert.',
  provenance_title: 'Herkunft',
  provenance_empty: 'Keine Herkunft hinterlegt.',
  variants_title: 'Kanal-native Varianten',
  variant_overridden: 'übersteuert von {who}',
  empty_title: 'Noch kein Werkstück in der Fabrik',
  empty_description:
    'Sobald Signale vorliegen (Feedback-Themen, ungenutzte Belege, wiederkehrende Fragen), entstehen hier Werkstücke.',
  error_generic: 'Das hat nicht geklappt.',
  states: {
    signal: 'Signal',
    angled: 'Blickwinkel',
    concepted: 'Konzept',
    drafted: 'Entwurf',
    gated: 'Gate bestanden',
    awaiting_approval: 'Freigabe ausstehend',
    scheduled: 'Geplant',
    published: 'Veröffentlicht',
    measured: 'Gemessen',
    rejected: 'Verworfen',
  },
  checks: {
    proof_binding: 'Proof-Bindung',
    language: 'Sprache',
    mention: 'Pathly-Erwähnung',
    sample_copy: 'Sample-Ähnlichkeit',
    narrative_consistency: 'Narrative Konsistenz',
    structure: 'Struktur',
    deterministic: 'Formatierung',
    self_similarity: 'Selbstähnlichkeit',
  },
  remedies: {
    add_proof: 'Beleg anlegen',
    rewrite_structure: 'Struktur überarbeiten',
    shorten: 'Kürzen',
    differentiate: 'Anders formulieren',
    correct_language: 'Sprache korrigieren',
    remove_mention: 'Erwähnung entfernen',
    place_mention: 'Erwähnung platzieren',
    needs_input: 'Eingabe ergänzen',
  },
  mix: {
    insight: 'Insight',
    proof: 'Proof/Case',
    story: 'Story',
    question: 'Frage',
  },
  evidence: {
    feedback: 'Feedback',
    proof: 'Beleg',
    community: 'Community',
    reference: 'Muster',
  },
};

const en: PipelineCopy = {
  title: 'Content factory',
  subtitle:
    'Signals become evidence-backed, channel-native posts. What fails the gate does not get published.',
  today_headline: 'Today',
  count_scheduled: 'scheduled',
  count_in_gate: 'in the gate',
  count_needs_proof: 'need proof',
  count_blocked: 'blocked',
  count_stalled: 'stalled',
  coverage_label: 'Coverage',
  coverage_days: '{days} days of material',
  coverage_unknown: 'Coverage unknown',
  coverage_warning: 'Under 3 days — fetch new signals before the cadence breaks.',
  run_button: 'Advance the factory one step',
  running: 'Running …',
  estimate_title: 'Cost estimate before the run',
  estimate_line: '{items} item(s) × {channels} channels = {calls} call(s), about {credits} credits.',
  estimate_saved: 'Batching saves {saved} credits versus one call per channel.',
  schedule_button: 'Schedule by mix',
  scheduling: 'Scheduling …',
  gate_button: 'Run gate',
  gate_running: 'Checking …',
  gate_title: 'Gate result',
  gate_passed: 'passed',
  gate_blocked: 'blocked',
  gate_skipped_note: 'skipped — this check did not run',
  gate_stats_title: 'Gate statistics',
  gate_stats_line: '{passed} passed, {blocked} blocked, {overridden} overridden',
  gate_stats_hint:
    'If the gate blocks almost everything, the thresholds are too tight — not the drafts too weak.',
  override_button: 'Override',
  override_title: 'Override the gate',
  override_placeholder: 'Why may this draft go out despite the finding? (this is logged)',
  override_hint:
    'An override is recorded with your name, a timestamp and the reason. Without a log the gate is only a request.',
  override_confirm: 'Override and log',
  override_cancel: 'Cancel',
  override_done: 'Override logged.',
  provenance_title: 'Provenance',
  provenance_empty: 'No provenance recorded.',
  variants_title: 'Channel-native variants',
  variant_overridden: 'overridden by {who}',
  empty_title: 'No item in the factory yet',
  empty_description:
    'As soon as signals exist (feedback themes, unused proof, recurring questions), items appear here.',
  error_generic: 'That did not work.',
  states: {
    signal: 'Signal',
    angled: 'Angle',
    concepted: 'Concept',
    drafted: 'Draft',
    gated: 'Gate passed',
    awaiting_approval: 'Awaiting approval',
    scheduled: 'Scheduled',
    published: 'Published',
    measured: 'Measured',
    rejected: 'Rejected',
  },
  checks: {
    proof_binding: 'Proof binding',
    language: 'Language',
    mention: 'Pathly mention',
    sample_copy: 'Sample similarity',
    narrative_consistency: 'Narrative consistency',
    structure: 'Structure',
    deterministic: 'Formatting',
    self_similarity: 'Self-similarity',
  },
  remedies: {
    add_proof: 'Add proof',
    rewrite_structure: 'Rewrite structure',
    shorten: 'Shorten',
    differentiate: 'Differentiate',
    correct_language: 'Correct language',
    remove_mention: 'Remove mention',
    place_mention: 'Place mention',
    needs_input: 'Add input',
  },
  mix: {
    insight: 'Insight',
    proof: 'Proof/case',
    story: 'Story',
    question: 'Question',
  },
  evidence: {
    feedback: 'Feedback',
    proof: 'Proof',
    community: 'Community',
    reference: 'Pattern',
  },
};

const es: PipelineCopy = {
  title: 'Fábrica de contenido',
  subtitle:
    'Las señales se convierten en publicaciones nativas por canal y con pruebas. Lo que no pasa la puerta no se publica.',
  today_headline: 'Hoy',
  count_scheduled: 'programadas',
  count_in_gate: 'en la puerta',
  count_needs_proof: 'necesitan prueba',
  count_blocked: 'bloqueadas',
  count_stalled: 'atascadas',
  coverage_label: 'Alcance',
  coverage_days: '{days} días de material',
  coverage_unknown: 'Alcance desconocido',
  coverage_warning: 'Menos de 3 días — consigue señales nuevas antes de que caiga la cadencia.',
  run_button: 'Avanzar la fábrica un paso',
  running: 'En marcha …',
  estimate_title: 'Estimación de coste antes de ejecutar',
  estimate_line:
    '{items} pieza(s) × {channels} canales = {calls} llamada(s), unos {credits} créditos.',
  estimate_saved: 'El agrupamiento ahorra {saved} créditos frente a una llamada por canal.',
  schedule_button: 'Programar por mezcla',
  scheduling: 'Programando …',
  gate_button: 'Ejecutar la puerta',
  gate_running: 'Comprobando …',
  gate_title: 'Resultado de la puerta',
  gate_passed: 'aprobado',
  gate_blocked: 'bloqueado',
  gate_skipped_note: 'omitido — esta comprobación no se ejecutó',
  gate_stats_title: 'Estadística de la puerta',
  gate_stats_line: '{passed} aprobadas, {blocked} bloqueadas, {overridden} forzadas',
  gate_stats_hint:
    'Si la puerta bloquea casi todo, los umbrales están demasiado estrictos — no los borradores demasiado flojos.',
  override_button: 'Forzar',
  override_title: 'Forzar la puerta',
  override_placeholder: '¿Por qué puede salir este borrador pese al hallazgo? (queda registrado)',
  override_hint:
    'Forzar queda registrado con tu nombre, fecha y motivo. Sin registro, la puerta es solo una petición.',
  override_confirm: 'Forzar y registrar',
  override_cancel: 'Cancelar',
  override_done: 'Forzado registrado.',
  provenance_title: 'Procedencia',
  provenance_empty: 'Sin procedencia registrada.',
  variants_title: 'Variantes nativas por canal',
  variant_overridden: 'forzado por {who}',
  empty_title: 'Todavía no hay piezas en la fábrica',
  empty_description:
    'En cuanto existan señales (temas de feedback, pruebas sin usar, preguntas recurrentes), aparecerán aquí.',
  error_generic: 'Eso no ha funcionado.',
  states: {
    signal: 'Señal',
    angled: 'Enfoque',
    concepted: 'Concepto',
    drafted: 'Borrador',
    gated: 'Puerta superada',
    awaiting_approval: 'Pendiente de aprobación',
    scheduled: 'Programado',
    published: 'Publicado',
    measured: 'Medido',
    rejected: 'Descartado',
  },
  checks: {
    proof_binding: 'Vínculo con pruebas',
    language: 'Idioma',
    mention: 'Mención de Pathly',
    sample_copy: 'Similitud con muestras',
    narrative_consistency: 'Consistencia narrativa',
    structure: 'Estructura',
    deterministic: 'Formato',
    self_similarity: 'Auto-similitud',
  },
  remedies: {
    add_proof: 'Añadir prueba',
    rewrite_structure: 'Reescribir la estructura',
    shorten: 'Acortar',
    differentiate: 'Diferenciar',
    correct_language: 'Corregir idioma',
    remove_mention: 'Eliminar mención',
    place_mention: 'Colocar mención',
    needs_input: 'Añadir información',
  },
  mix: {
    insight: 'Insight',
    proof: 'Prueba/caso',
    story: 'Historia',
    question: 'Pregunta',
  },
  evidence: {
    feedback: 'Feedback',
    proof: 'Prueba',
    community: 'Comunidad',
    reference: 'Patrón',
  },
};

const PIPELINE_COPY: Record<AppLocale, PipelineCopy> = { de, en, es };

export function getPipelineCopy(locale: AppLocale): PipelineCopy {
  return PIPELINE_COPY[locale];
}

/** fillCopy('{days} Tage', { days: 12 }) → '12 Tage' */
export function fillCopy(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}
