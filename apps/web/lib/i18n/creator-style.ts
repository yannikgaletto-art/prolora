import type { AppLocale, StylePreset } from '@prolora/shared';

type StyleCopy = Record<StylePreset, { label: string; description: string }>;

const COPY: Record<AppLocale, StyleCopy> = {
  de: {
    neutral: { label: 'Neutral', description: 'Folgt deinem Workspace-Ton ohne zusätzliche Strukturmechanik.' },
    welsh_short: { label: 'Kurz & Weißraum', description: 'Kurze Absätze, vertrauter Gegner und Cliffhanger — Mechanik bekannt durch Justin Welsh.' },
    koe_pia: { label: 'PIA-Essay', description: 'Pain → Insight → Action mit Anti-Vision — Mechanik bekannt durch Dan Koe.' },
    abdaal_evidence: { label: 'Evidenz-Story', description: '„How I…“-Transformation mit konkreten Belegen — Mechanik bekannt durch Ali Abdaal.' },
    hormozi_carousel: { label: 'Kontrast-Punchy', description: 'Scharfe These, Beweis und ein Schritt pro Slide — Mechanik bekannt durch Alex Hormozi.' },
    ai_automation_screencast: { label: 'Workflow-Screencast', description: 'Kurzer Automations-Loop plus konkreter Nutzen-Stack — Mechanik bekannt durch Ruben Hassid/Saraev.' },
    doku_modus: { label: 'Doku-Modus', description: 'Ungefiltert, konkret und ohne Marketingmuster: Blick über die Schulter.' },
  },
  en: {
    neutral: { label: 'Neutral', description: 'Follows your workspace voice without an additional structural mechanism.' },
    welsh_short: { label: 'Short & spacious', description: 'Short paragraphs, a relatable enemy and a cliffhanger — a mechanism associated with Justin Welsh.' },
    koe_pia: { label: 'PIA essay', description: 'Pain → Insight → Action with an anti-vision — a mechanism associated with Dan Koe.' },
    abdaal_evidence: { label: 'Evidence story', description: 'A “How I…” transformation supported by concrete evidence — a mechanism associated with Ali Abdaal.' },
    hormozi_carousel: { label: 'Contrast punch', description: 'A sharp claim, proof and one step per slide — a mechanism associated with Alex Hormozi.' },
    ai_automation_screencast: { label: 'Workflow screencast', description: 'A short automation loop with a concrete value stack — a mechanism associated with Ruben Hassid/Saraev.' },
    doku_modus: { label: 'Documentation mode', description: 'Unfiltered, concrete and free of marketing patterns: a look over your shoulder.' },
  },
  es: {
    neutral: { label: 'Neutral', description: 'Sigue la voz del espacio de trabajo sin una mecánica estructural adicional.' },
    welsh_short: { label: 'Breve y aireado', description: 'Párrafos breves, enemigo reconocible y suspense — mecánica asociada a Justin Welsh.' },
    koe_pia: { label: 'Ensayo PIA', description: 'Dolor → Insight → Acción con anti-visión — mecánica asociada a Dan Koe.' },
    abdaal_evidence: { label: 'Historia con evidencia', description: 'Transformación «Cómo logré…» con pruebas concretas — mecánica asociada a Ali Abdaal.' },
    hormozi_carousel: { label: 'Contraste contundente', description: 'Tesis afilada, prueba y un paso por diapositiva — mecánica asociada a Alex Hormozi.' },
    ai_automation_screencast: { label: 'Screencast de flujo', description: 'Bucle breve de automatización y valor concreto — mecánica asociada a Ruben Hassid/Saraev.' },
    doku_modus: { label: 'Modo documentación', description: 'Sin filtros, concreto y sin patrones de marketing: mirada entre bastidores.' },
  },
};

export function getCreatorStyleCopy(locale: AppLocale): StyleCopy {
  return COPY[locale];
}
