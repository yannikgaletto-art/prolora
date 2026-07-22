// Product profile + product-to-post chrome copy (GOAL-RUN9). Same pattern as
// creator-style.ts: one self-contained file, all three locales, typed keys.
import type { AppLocale, ConceptLens, ContentGoal, ProofAssetType } from '@prolora/shared';

export interface ProductCopy {
  profile_title: string;
  profile_subtitle: string;
  section_what: string;
  section_what_help: string;
  section_audience: string;
  section_audience_help: string;
  section_value: string;
  section_value_help: string;
  section_founder: string;
  section_founder_help: string;
  section_proof: string;
  section_proof_help: string;
  proof_add: string;
  proof_empty: string;
  proof_delete: string;
  proof_content_placeholder: string;
  proof_types: Record<ProofAssetType, string>;
  dictate: string;
  dictate_stop: string;
  save: string;
  saving: string;
  saved: string;
  save_error: string;
  website_hint: string;
  start_title: string;
  start_subtitle: string;
  start_no_profile: string;
  start_setup_cta: string;
  start_edit_profile: string;
  goal_label: string;
  goals: Record<ContentGoal, { label: string; hint: string }>;
  recommends_title: string;
  recommends_empty: string;
  own_idea: string;
  own_idea_placeholder: string;
  settings_open: string;
  settings_title: string;
  setting_value_density: string;
  setting_length: string;
  setting_length_options: { short: string; medium: string; long: string };
  setting_community: string;
  setting_vulnerability: string;
  setting_tone: string;
  setting_tone_options: { reflective: string; direct: string; provocative: string; educational: string };
  setting_include_data: string;
  setting_include_framework: string;
  setting_include_cta: string;
  generate_cta: string;
  generating: string;
  generating_hint: string;
  generate_error: string;
  drafts_title: string;
  lens_labels: Record<ConceptLens, string>;
  based_on: string;
  unverified_badge: string;
  open_draft: string;
  follow_up_title: string;
  follow_up_hint: string;
  follow_up_regenerate: string;
  shortform_fallback_hint: string;
  credits_note: string;
}

const COPY: Record<AppLocale, ProductCopy> = {
  de: {
    profile_title: 'Produktprofil',
    profile_subtitle:
      'Einmal anlegen — Prolora nutzt es für jeden Post-Vorschlag. Je konkreter deine Beweise, desto weniger generisch die Entwürfe.',
    section_what: 'Was ist dein Produkt?',
    section_what_help: 'Ein bis zwei Sätze, wie du es einem Fremden erklären würdest.',
    section_audience: 'Für wen ist es?',
    section_audience_help: 'Zielgruppen, durch Komma getrennt.',
    section_value: 'Welchen konkreten Value liefert es?',
    section_value_help: 'Ein Nutzen pro Zeile — Ergebnis, nicht Feature.',
    section_founder: 'Deine Founder-Perspektive',
    section_founder_help: 'Warum baust DU das? Eine ehrliche Beobachtung, kein Pitch.',
    section_proof: 'Beweise & Beobachtungen (ProofAssets)',
    section_proof_help:
      'Zahlen, Nutzerfeedback, Experimente, Erkenntnisse. Jeder Produkt-Claim in einem Entwurf braucht so einen Beleg — ohne Beleg formuliert Prolora ehrlich als Hypothese.',
    proof_add: 'Hinzufügen',
    proof_empty: 'Noch keine Beweise — schon eine einzige echte Beobachtung macht Entwürfe spürbar konkreter.',
    proof_delete: 'Löschen',
    proof_content_placeholder: 'z. B. „Ich habe 1.200 Stellenanzeigen analysiert und …"',
    proof_types: {
      metric: 'Zahl / Metrik',
      customer_quote: 'Nutzer-Zitat',
      founder_observation: 'Eigene Beobachtung',
      case_study: 'Fallstudie',
      experiment: 'Experiment',
    },
    dictate: 'Diktieren',
    dictate_stop: 'Stopp',
    save: 'Profil speichern',
    saving: 'Speichert …',
    saved: 'Gespeichert.',
    save_error: 'Speichern fehlgeschlagen — bitte erneut versuchen.',
    website_hint: 'Basisdaten kommen aus deiner Website-Analyse (Discover → Auto-Context) und können hier verfeinert werden.',
    start_title: 'Was posten wir heute?',
    start_subtitle: 'Wähle ein Ziel — Prolora schlägt drei fundierte Angles für dein Produkt vor.',
    start_no_profile: 'Prolora kennt dein Produkt noch nicht. Mit Profil werden Vorschläge konkret statt generisch.',
    start_setup_cta: 'Produktprofil anlegen',
    start_edit_profile: 'Profil bearbeiten',
    goal_label: 'Ziel dieses Posts',
    goals: {
      authority: { label: 'Autorität zeigen', hint: 'Expertise durch Daten und klare Modelle' },
      community: { label: 'Diskussion starten', hint: 'Ehrliche Frage oder offene Position' },
      productEducation: { label: 'Produkt erklären', hint: 'Problem zeigen, Lösung beiläufig' },
      buildInPublic: { label: 'Build in Public', hint: 'Entscheidungen, Tests, Fehler, Fortschritt' },
      conversion: { label: 'Conversion', hint: 'Warteliste, Demo oder Produktseite' },
      personalStory: { label: 'Persönliche Story', hint: 'Erkenntnis, Strategiewechsel oder Fehler' },
    },
    recommends_title: 'Prolora empfiehlt heute',
    recommends_empty: 'Für dieses Ziel gibt es noch keine passenden Muster — beschreibe deine Idee unten selbst.',
    own_idea: 'Eigene Idee eingeben',
    own_idea_placeholder: 'Worum soll es gehen? Stichworte oder Diktat reichen — unsortiert ist okay.',
    settings_open: 'Feinjustierung',
    settings_title: 'Feinjustierung',
    setting_value_density: 'Value-Dichte',
    setting_length: 'Länge',
    setting_length_options: { short: 'Kurz (400–700)', medium: 'Mittel (700–1.300)', long: 'Lang (1.300–2.300)' },
    setting_community: 'Community-Commitment',
    setting_vulnerability: 'Verletzlichkeit',
    setting_tone: 'Ton',
    setting_tone_options: {
      reflective: 'Reflektiert',
      direct: 'Direkt',
      provocative: 'Provokant',
      educational: 'Erklärend',
    },
    setting_include_data: 'Daten/Zahlen einbauen',
    setting_include_framework: 'Framework/Struktur zeigen',
    setting_include_cta: 'CTA ans Ende',
    generate_cta: '3 Entwürfe generieren',
    generating: 'Generiert …',
    generating_hint: 'Drei echte Varianten dauern einen Moment — Evidenz, Founder-Story und Community-Angle entstehen getrennt.',
    generate_error: 'Generierung fehlgeschlagen — bitte erneut versuchen.',
    drafts_title: 'Deine drei Entwürfe',
    lens_labels: { evidence: 'Evidenz', founder: 'Founder-Story', community: 'Community' },
    based_on: 'Basiert auf Muster',
    unverified_badge: 'Muster-Referenz (unverifiziert)',
    open_draft: 'Diesen Entwurf öffnen',
    follow_up_title: 'Prolora hat Rückfragen',
    follow_up_hint: 'Dein Material war dünn. Beantworte kurz (Diktat reicht) — der zweite Lauf kostet nichts extra.',
    follow_up_regenerate: 'Mit Antworten neu generieren',
    shortform_fallback_hint: 'Unter deinen Zielen ist eine Kurz-Plattform — dafür wird automatisch eine Kurzfassung erstellt.',
    credits_note: '1 Credit pro Generierung',
  },
  en: {
    profile_title: 'Product profile',
    profile_subtitle:
      'Set it up once — Prolora reuses it for every post suggestion. The more concrete your proof, the less generic the drafts.',
    section_what: 'What is your product?',
    section_what_help: 'One or two sentences, the way you would explain it to a stranger.',
    section_audience: 'Who is it for?',
    section_audience_help: 'Target audiences, comma-separated.',
    section_value: 'What concrete value does it deliver?',
    section_value_help: 'One benefit per line — outcome, not feature.',
    section_founder: 'Your founder perspective',
    section_founder_help: 'Why are YOU building this? An honest observation, not a pitch.',
    section_proof: 'Proof & observations (ProofAssets)',
    section_proof_help:
      'Numbers, user feedback, experiments, findings. Every product claim in a draft needs one of these — without proof Prolora frames it honestly as a hypothesis.',
    proof_add: 'Add',
    proof_empty: 'No proof yet — even a single real observation makes drafts noticeably more concrete.',
    proof_delete: 'Delete',
    proof_content_placeholder: 'e.g. "I analyzed 1,200 job postings and …"',
    proof_types: {
      metric: 'Number / metric',
      customer_quote: 'User quote',
      founder_observation: 'Own observation',
      case_study: 'Case study',
      experiment: 'Experiment',
    },
    dictate: 'Dictate',
    dictate_stop: 'Stop',
    save: 'Save profile',
    saving: 'Saving …',
    saved: 'Saved.',
    save_error: 'Saving failed — please try again.',
    website_hint: 'Base data comes from your website analysis (Discover → auto-context) and can be refined here.',
    start_title: 'What are we posting today?',
    start_subtitle: 'Pick a goal — Prolora suggests three grounded angles for your product.',
    start_no_profile: 'Prolora does not know your product yet. With a profile, suggestions get concrete instead of generic.',
    start_setup_cta: 'Create product profile',
    start_edit_profile: 'Edit profile',
    goal_label: 'Goal of this post',
    goals: {
      authority: { label: 'Show authority', hint: 'Expertise through data and clear models' },
      community: { label: 'Start a discussion', hint: 'An honest question or open position' },
      productEducation: { label: 'Explain the product', hint: 'Show the problem, solve it casually' },
      buildInPublic: { label: 'Build in public', hint: 'Decisions, tests, mistakes, progress' },
      conversion: { label: 'Conversion', hint: 'Waitlist, demo or product page' },
      personalStory: { label: 'Personal story', hint: 'Insight, strategy change or mistake' },
    },
    recommends_title: 'Prolora recommends today',
    recommends_empty: 'No matching patterns for this goal yet — describe your own idea below.',
    own_idea: 'Enter your own idea',
    own_idea_placeholder: 'What should it be about? Keywords or dictation are fine — unsorted is okay.',
    settings_open: 'Fine-tune',
    settings_title: 'Fine-tune',
    setting_value_density: 'Value density',
    setting_length: 'Length',
    setting_length_options: { short: 'Short (400–700)', medium: 'Medium (700–1,300)', long: 'Long (1,300–2,300)' },
    setting_community: 'Community commitment',
    setting_vulnerability: 'Vulnerability',
    setting_tone: 'Tone',
    setting_tone_options: {
      reflective: 'Reflective',
      direct: 'Direct',
      provocative: 'Provocative',
      educational: 'Educational',
    },
    setting_include_data: 'Include data/numbers',
    setting_include_framework: 'Show a framework/structure',
    setting_include_cta: 'End with a CTA',
    generate_cta: 'Generate 3 drafts',
    generating: 'Generating …',
    generating_hint: 'Three real variants take a moment — evidence, founder story and community angle are built separately.',
    generate_error: 'Generation failed — please try again.',
    drafts_title: 'Your three drafts',
    lens_labels: { evidence: 'Evidence', founder: 'Founder story', community: 'Community' },
    based_on: 'Based on pattern',
    unverified_badge: 'Pattern reference (unverified)',
    open_draft: 'Open this draft',
    follow_up_title: 'Prolora has follow-up questions',
    follow_up_hint: 'Your material was thin. Answer briefly (dictation works) — the second run costs nothing extra.',
    follow_up_regenerate: 'Regenerate with answers',
    shortform_fallback_hint: 'One of your targets is a short-form platform — a short version will be created for it automatically.',
    credits_note: '1 credit per generation',
  },
  es: {
    profile_title: 'Perfil del producto',
    profile_subtitle:
      'Configúralo una vez — Prolora lo reutiliza en cada sugerencia. Cuanto más concreta la evidencia, menos genéricos los borradores.',
    section_what: '¿Qué es tu producto?',
    section_what_help: 'Una o dos frases, como se lo explicarías a un desconocido.',
    section_audience: '¿Para quién es?',
    section_audience_help: 'Audiencias objetivo, separadas por comas.',
    section_value: '¿Qué valor concreto aporta?',
    section_value_help: 'Un beneficio por línea — resultado, no funcionalidad.',
    section_founder: 'Tu perspectiva como founder',
    section_founder_help: '¿Por qué lo construyes TÚ? Una observación honesta, no un pitch.',
    section_proof: 'Pruebas y observaciones (ProofAssets)',
    section_proof_help:
      'Números, feedback de usuarios, experimentos, hallazgos. Cada afirmación sobre el producto necesita una prueba — sin prueba, Prolora lo formula honestamente como hipótesis.',
    proof_add: 'Añadir',
    proof_empty: 'Aún no hay pruebas — una sola observación real hace los borradores notablemente más concretos.',
    proof_delete: 'Eliminar',
    proof_content_placeholder: 'p. ej. «Analicé 1.200 ofertas de empleo y …»',
    proof_types: {
      metric: 'Cifra / métrica',
      customer_quote: 'Cita de usuario',
      founder_observation: 'Observación propia',
      case_study: 'Caso de estudio',
      experiment: 'Experimento',
    },
    dictate: 'Dictar',
    dictate_stop: 'Parar',
    save: 'Guardar perfil',
    saving: 'Guardando …',
    saved: 'Guardado.',
    save_error: 'Error al guardar — inténtalo de nuevo.',
    website_hint: 'Los datos base vienen del análisis de tu web (Discover → auto-context) y puedes refinarlos aquí.',
    start_title: '¿Qué publicamos hoy?',
    start_subtitle: 'Elige un objetivo — Prolora sugiere tres ángulos fundamentados para tu producto.',
    start_no_profile: 'Prolora aún no conoce tu producto. Con un perfil, las sugerencias son concretas en vez de genéricas.',
    start_setup_cta: 'Crear perfil del producto',
    start_edit_profile: 'Editar perfil',
    goal_label: 'Objetivo de este post',
    goals: {
      authority: { label: 'Mostrar autoridad', hint: 'Experiencia con datos y modelos claros' },
      community: { label: 'Abrir debate', hint: 'Una pregunta honesta o posición abierta' },
      productEducation: { label: 'Explicar el producto', hint: 'Mostrar el problema, resolverlo de paso' },
      buildInPublic: { label: 'Build in public', hint: 'Decisiones, pruebas, errores, progreso' },
      conversion: { label: 'Conversión', hint: 'Lista de espera, demo o página del producto' },
      personalStory: { label: 'Historia personal', hint: 'Aprendizaje, cambio de estrategia o error' },
    },
    recommends_title: 'Prolora recomienda hoy',
    recommends_empty: 'Aún no hay patrones para este objetivo — describe tu propia idea abajo.',
    own_idea: 'Escribir idea propia',
    own_idea_placeholder: '¿De qué debería tratar? Palabras clave o dictado bastan — desordenado está bien.',
    settings_open: 'Ajuste fino',
    settings_title: 'Ajuste fino',
    setting_value_density: 'Densidad de valor',
    setting_length: 'Longitud',
    setting_length_options: { short: 'Corto (400–700)', medium: 'Medio (700–1.300)', long: 'Largo (1.300–2.300)' },
    setting_community: 'Compromiso con la comunidad',
    setting_vulnerability: 'Vulnerabilidad',
    setting_tone: 'Tono',
    setting_tone_options: {
      reflective: 'Reflexivo',
      direct: 'Directo',
      provocative: 'Provocador',
      educational: 'Educativo',
    },
    setting_include_data: 'Incluir datos/cifras',
    setting_include_framework: 'Mostrar un framework/estructura',
    setting_include_cta: 'Terminar con CTA',
    generate_cta: 'Generar 3 borradores',
    generating: 'Generando …',
    generating_hint: 'Tres variantes reales tardan un momento — evidencia, historia de founder y ángulo de comunidad se crean por separado.',
    generate_error: 'La generación falló — inténtalo de nuevo.',
    drafts_title: 'Tus tres borradores',
    lens_labels: { evidence: 'Evidencia', founder: 'Historia de founder', community: 'Comunidad' },
    based_on: 'Basado en el patrón',
    unverified_badge: 'Referencia de patrón (sin verificar)',
    open_draft: 'Abrir este borrador',
    follow_up_title: 'Prolora tiene preguntas',
    follow_up_hint: 'Tu material era escaso. Responde brevemente (el dictado sirve) — la segunda ronda no cuesta extra.',
    follow_up_regenerate: 'Regenerar con respuestas',
    shortform_fallback_hint: 'Uno de tus destinos es una plataforma corta — se creará automáticamente una versión breve.',
    credits_note: '1 crédito por generación',
  },
};

export function getProductCopy(locale: AppLocale): ProductCopy {
  return COPY[locale] ?? COPY.de;
}
