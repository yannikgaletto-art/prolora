import {
  DEFAULT_WRITER_POLICY,
  type WriterDnaSample,
  type WriterReview,
  type WriterUiData,
} from './writer-model';

const DEMO_REVIEW: WriterReview = {
  id: 'writer-demo-review',
  snapshotHash: 'demo-snapshot-v1',
  title: 'Warum gute Onboarding-Mails weniger erklären sollten',
  preview:
    'Die beste Onboarding-Mail beantwortet nicht jede Frage. Sie macht den nächsten Schritt so klar, dass keine offen bleibt.',
  whyNow:
    'Dieses Thema verbindet wiederkehrendes Feedback mit deinem Produktkontext und ist für den nächsten freien LinkedIn-Slot vorgesehen.',
  proposedLocalTime: 'Morgen, 09:30',
  timezone: 'Europe/Berlin',
  proposedUtcTime: '2026-08-01T07:30:00.000Z',
  dnaVersion: 1,
  dnaSampleCount: 3,
  sourceCount: 2,
  warnings: [],
  skippedChecks: [],
  overrides: [],
  changes: [],
  claims: [
    {
      text: 'Onboarding wird klarer, wenn der nächste Schritt zuerst kommt.',
      sourceLabel: 'Produktfeedback · Aktivierung',
      sourceUrl: null,
      verified: true,
    },
    {
      text: 'Kurze, konkrete Beispiele erhöhen die Verständlichkeit.',
      sourceLabel: 'Golden Samples · Content DNA',
      sourceUrl: null,
      verified: true,
    },
  ],
  channels: [
    {
      id: 'writer-demo-linkedin',
      platform: 'linkedin',
      accountName: 'Dein LinkedIn-Profil',
      format: 'post',
      content:
        'Die beste Onboarding-Mail beantwortet nicht jede Frage.\n\nSie macht den nächsten Schritt so klar, dass keine offen bleibt.\n\nViele Teams erklären zuerst alle Funktionen. Das klingt vollständig, lässt neue Nutzer aber mit einer Entscheidung allein.\n\nBesser: ein konkreter nächster Schritt, ein echtes Beispiel, ein klarer Nutzen.\n\nWas ist der eine Schritt, den neue Nutzer bei euch sofort verstehen sollten?',
      segments: [],
      media: [],
      firstComment: 'Ein guter Test: Kann jemand nach 10 Sekunden sagen, was als Nächstes zu tun ist?',
      gatePassed: true,
    },
  ],
};

const DEMO_SAMPLES: WriterDnaSample[] = [
  { id: 'demo-sample-1', kind: 'golden', origin: 'pasted', label: 'Klare Produktmeinung', platform: 'linkedin', active: true },
  { id: 'demo-sample-2', kind: 'golden', origin: 'pasted', label: 'Konkretes Gründerbeispiel', platform: 'linkedin', active: true },
  { id: 'demo-sample-3', kind: 'golden', origin: 'published', label: 'Lieblingspost', platform: 'linkedin', active: true },
];

/** A local-only walkthrough. It deliberately never calls Writer APIs or creates publishable rows. */
export function createWriterDemoData(workspaceName: string): WriterUiData {
  return {
    availability: 'ready',
    workspaceName,
    policy: { ...DEFAULT_WRITER_POLICY, enabled: false },
    stats: { awaitingApproval: 1, preparing: 0, goldenSamples: 3, exceptions: 0 },
    dna: {
      version: 1,
      status: 'active',
      sampleCount: DEMO_SAMPLES.length,
      goldenSampleCount: 3,
      avoidSampleCount: 0,
      confidence: 'preliminary',
      traits: ['Klar und meinungsstark', 'Kurze Absätze', 'Konkrete Beispiele vor Allgemeinplätzen'],
      lockedRules: ['Keine unbelegten Zahlen oder Erfolgsaussagen'],
      samples: DEMO_SAMPLES,
    },
    pendingReview: DEMO_REVIEW,
    history: [],
  };
}
