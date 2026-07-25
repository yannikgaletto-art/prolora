// DER wichtigste Test des ganzen Plans (Plan 2 §7.4).
//
// Wenn ein Entwurf mit einer ERFUNDENEN ZAHL ohne Proof-Asset das Gate
// passiert, ist das Gate wirkungslos und Plan 2 hat seine Existenzberechtigung
// verloren. Alles andere in dieser Datei sind Leitplanken darum herum: das
// Gate darf auch nicht ALLES blockieren, sonst kommt der Nutzer nie zum Posten.
import { describe, expect, test } from 'vitest';
import {
  checkProofBinding,
  extractVerifiableClaims,
  isClaimBound,
  isProofAssetEligible,
  normalizeNumericLiteral,
  resolveThresholds,
  runQualityGate,
  type GateProofAsset,
} from '@/lib/pipeline/quality-gate';

const VALID_STRUCTURE = {
  beweisbarer_ausgangspunkt: 'Wir haben 6 Wochen lang jedes Support-Ticket ausgewertet.',
  bruch: 'Unsere Annahme war, dass die Onboarding-Doku das Problem löst.',
  unerwarteter_befund: 'Die Tickets kamen fast alle aus einem einzigen Dialogschritt.',
  mechanismus: 'Wer dort abbricht, sieht die Doku nie — sie kommt erst danach.',
  handlungsregel: 'Erst den Abbruchpunkt messen, dann Doku schreiben.',
  reibungsfrage: 'Wo bricht dein Onboarding wirklich ab?',
};

// Ein sauber formatierter Entwurf, damit Prüfung 3 nicht das Ergebnis verfälscht.
function draftWith(claimSentence: string): string {
  return [
    'Wir haben sechs Wochen lang jedes Ticket gelesen.',
    '',
    claimSentence,
    '',
    'Der Grund lag an einer Stelle, die wir nie gemessen hatten.',
    '',
    'Miss zuerst den Abbruch. Schreib die Doku danach.',
  ].join('\n');
}

describe('Prüfung 1 — Proof-Bindung blockiert erfundene Zahlen', () => {
  test('erfundene Zahl OHNE Proof-Asset wird BLOCKIERT', async () => {
    const result = await runQualityGate({
      content: draftWith('Die Ticketlast ist danach um 47 % gesunken.'),
      platform: 'linkedin',
      structure: VALID_STRUCTURE,
      proofAssets: [], // kein einziger Beleg
    });

    expect(result.passed).toBe(false);
    const proofFinding = result.findings.find((entry) => entry.check === 'proof_binding');
    expect(proofFinding?.status).toBe('failed');
    expect(proofFinding?.passed).toBe(false);
    expect(proofFinding?.remedy).toBe('add_proof');
    // Der Span muss auf die Fundstelle zeigen, damit die UI sie markieren kann.
    expect(proofFinding?.span).not.toBeNull();
    // Abbruch bei Nichtbestehen: die späteren Prüfungen laufen gar nicht erst.
    expect(result.findings.map((entry) => entry.check)).toEqual(['proof_binding']);
  });

  test('Zahl, die in KEINEM hinterlegten Beleg vorkommt, wird BLOCKIERT', async () => {
    const proofs: GateProofAsset[] = [
      { id: 'p1', type: 'metric', content: 'Ticket-Rückgang 31 % nach dem Onboarding-Umbau' },
    ];
    const result = await runQualityGate({
      content: draftWith('Die Ticketlast ist danach um 47 % gesunken.'),
      platform: 'linkedin',
      structure: VALID_STRUCTURE,
      proofAssets: proofs,
    });

    expect(result.passed).toBe(false);
    const proofFinding = result.findings.find((entry) => entry.check === 'proof_binding');
    expect(proofFinding?.status).toBe('failed');
    expect(proofFinding?.message).toContain('47');
  });

  test('dieselbe Zahl MIT passendem Beleg kommt durch Prüfung 1', () => {
    const proofs: GateProofAsset[] = [
      { id: 'p1', type: 'metric', content: 'Ticket-Rückgang 31 % nach dem Onboarding-Umbau' },
    ];
    const finding = checkProofBinding({
      content: draftWith('Die Ticketlast ist danach um 31 % gesunken.'),
      proofAssets: proofs,
    });
    expect(finding.status).toBe('passed');
  });

  test('Beleg ohne DSGVO-Zustimmung zählt NICHT als Beleg', async () => {
    const withoutConsent: GateProofAsset[] = [
      {
        id: 'p1',
        type: 'customer_quote',
        content: '„Unsere Ticketlast ist um 31 % gesunken." — Kundin K.',
        consentStatus: 'pending',
      },
    ];
    const result = await runQualityGate({
      content: draftWith('Bei einer Kundin sank die Ticketlast um 31 %.'),
      platform: 'linkedin',
      structure: VALID_STRUCTURE,
      proofAssets: withoutConsent,
    });
    expect(result.passed).toBe(false);
    expect(result.findings[0].remedy).toBe('add_proof');

    // Dieselbe Aussage mit erteilter Zustimmung ist zulässig.
    const granted = checkProofBinding({
      content: draftWith('Bei einer Kundin sank die Ticketlast um 31 %.'),
      proofAssets: [{ ...withoutConsent[0], consentStatus: 'granted' }],
    });
    expect(granted.status).toBe('passed');
  });

  test('Übersteuern hebt die Blockade auf — aber nur mit protokolliertem Verursacher', async () => {
    const base = {
      content: draftWith('Die Ticketlast ist danach um 47 % gesunken.'),
      platform: 'linkedin' as const,
      structure: VALID_STRUCTURE,
      proofAssets: [],
    };
    const blocked = await runQualityGate(base);
    expect(blocked.passed).toBe(false);

    const overridden = await runQualityGate({ ...base, overriddenBy: 'user-42' });
    expect(overridden.passed).toBe(true);
    expect(overridden.overriddenBy).toBe('user-42');
    // Der Befund verschwindet NICHT — übersteuert heißt nicht "war nie da".
    expect(overridden.findings[0].status).toBe('failed');
  });
});

describe('Prüfung 1 erfasst auch unbezifferte Ergebnisbehauptungen', () => {
  // §6.2 verlangt Belege für "Zahl, ERGEBNIS, Vergleich". "Drastisch gesunken"
  // ist ein Ergebnis — und die unfalsifizierbarste Sorte davon.
  const cases = [
    { satz: 'Die Ticketlast hat sich danach mehr als halbiert.', art: 'comparative' },
    { satz: 'Wir sind damit doppelt so schnell geworden wie vorher.', art: 'comparative' },
    { satz: 'Unsere Churn-Rate ist seitdem drastisch gesunken.', art: 'vague_magnitude' },
  ] as const;

  for (const { satz, art } of cases) {
    test(`blockiert: "${satz}"`, async () => {
      const result = await runQualityGate({
        content: draftWith(satz),
        platform: 'linkedin',
        structure: VALID_STRUCTURE,
        proofAssets: [],
      });
      expect(result.passed).toBe(false);
      const proofFinding = result.findings.find((entry) => entry.check === 'proof_binding');
      expect(proofFinding?.status).toBe('failed');
      expect(proofFinding?.remedy).toBe('add_proof');
      expect(proofFinding?.span).not.toBeNull();

      const claims = extractVerifiableClaims(draftWith(satz));
      expect(claims.some((claim) => claim.kind === art)).toBe(true);
    });
  }

  test('die Meldung zeigt auf die fehlende Zahl, nicht auf einen fehlenden Beleg', async () => {
    const result = await runQualityGate({
      content: draftWith('Unsere Churn-Rate ist seitdem drastisch gesunken.'),
      platform: 'linkedin',
      structure: VALID_STRUCTURE,
      proofAssets: [],
    });
    const message = result.findings[0].message;
    expect(message).toContain('drastisch gesunken');
    expect(message).toMatch(/beziffern/i);
  });

  test('der Span umfasst Steigerung UND Veränderungsverb', () => {
    const text = 'Unsere Churn-Rate ist seitdem drastisch gesunken.';
    const claim = extractVerifiableClaims(text).find((c) => c.kind === 'vague_magnitude');
    expect(claim).toBeDefined();
    expect(text.slice(claim!.start, claim!.end)).toBe('drastisch gesunken');
  });

  test('weitere vage Steigerungen werden ebenfalls erfasst', () => {
    for (const satz of [
      'Der Aufwand ist massiv zurückgegangen.',
      'Die Antwortzeit hat sich erheblich verbessert.',
      'Support tickets dropped significantly since then.',
      'Die Conversion ist spürbar gestiegen.',
    ]) {
      const claims = extractVerifiableClaims(satz);
      expect(claims.some((claim) => claim.kind === 'vague_magnitude'), satz).toBe(true);
    }
  });

  test('mit passendem Beleg kommt dieselbe Aussage durch', () => {
    const finding = checkProofBinding({
      content: draftWith('Unsere Churn-Rate ist seitdem drastisch gesunken.'),
      proofAssets: [
        {
          id: 'p1',
          type: 'metric',
          content: 'Churn-Rate drastisch gesunken: von 8,1 % auf 3,4 % in zwei Quartalen.',
        },
      ],
    });
    expect(finding.status).toBe('passed');
  });

  test('die Regel ist getrennt von den Vergleichen abschaltbar', () => {
    const off = checkProofBinding({
      content: draftWith('Unsere Churn-Rate ist seitdem drastisch gesunken.'),
      proofAssets: [],
      thresholds: resolveThresholds({ proofBinding: { requireProofForVagueMagnitude: false } }),
    });
    expect(off.status).toBe('passed');

    // Die Vergleichs-Regel bleibt davon unberührt.
    const stillOn = checkProofBinding({
      content: draftWith('Die Ticketlast hat sich danach mehr als halbiert.'),
      proofAssets: [],
      thresholds: resolveThresholds({ proofBinding: { requireProofForVagueMagnitude: false } }),
    });
    expect(stillOn.status).toBe('failed');
  });
});

describe('vage Steigerungen ohne Behauptung bleiben unbeanstandet', () => {
  // Ein bloßer Wortabgleich auf "deutlich" würde hier über-blockieren (§8).
  const harmlos = [
    'Ich sage das ganz deutlich.',
    'Der Unterschied war für uns spürbar.',
    'Das war uns deutlich, bevor wir angefangen haben.',
    'Wir haben massiv investiert und viel gelernt.',
  ];

  for (const satz of harmlos) {
    test(`kein Befund: "${satz}"`, () => {
      expect(extractVerifiableClaims(satz)).toHaveLength(0);
      expect(checkProofBinding({ content: satz, proofAssets: [] }).status).toBe('passed');
    });
  }

  test('Steigerungswort und Veränderungsverb in VERSCHIEDENEN Sätzen zählen nicht', () => {
    const text = 'Ich sage es deutlich. Der Umsatz ist gestiegen.';
    expect(
      extractVerifiableClaims(text).some((claim) => claim.kind === 'vague_magnitude')
    ).toBe(false);
  });

  test('ein bereits bezifferter Satz wird nicht zusätzlich beanstandet', () => {
    const text = 'Die Ticketlast ist um 31 % deutlich gesunken.';
    const claims = extractVerifiableClaims(text);
    expect(claims.some((claim) => claim.kind === 'vague_magnitude')).toBe(false);
    // Die Zahl selbst bleibt selbstverständlich belegpflichtig.
    expect(claims.some((claim) => claim.kind === 'number')).toBe(true);
  });

  test('Teilwörter lösen nichts aus', () => {
    expect(extractVerifiableClaims('Die Verdeutlichung war hilfreich und gewachsen.')).toHaveLength(
      0
    );
  });
});

describe('das Gate darf nicht alles blockieren', () => {
  test('Aufzählungs- und Strukturzahlen sind keine überprüfbaren Behauptungen', () => {
    const claims = extractVerifiableClaims(
      ['1. Erst messen', '2. Dann schreiben', '', 'Es sind 3 Schritte, nicht zehn.'].join('\n')
    );
    expect(claims).toHaveLength(0);
  });

  test('Jahreszahlen ohne Einheit gelten nicht als Leistungsbehauptung', () => {
    expect(extractVerifiableClaims('Seit 2024 bauen wir daran.')).toHaveLength(0);
  });

  test('Zahlen in URLs lösen keine Blockade aus', () => {
    expect(
      extractVerifiableClaims('Details: https://example.com/report/2024/47-prozent')
    ).toHaveLength(0);
  });

  test('ein Entwurf ganz ohne Zahlen besteht Prüfung 1', () => {
    const finding = checkProofBinding({
      content: 'Wir haben unser Onboarding umgebaut und dabei etwas Unerwartetes gelernt.',
      proofAssets: [],
    });
    expect(finding.status).toBe('passed');
  });
});

describe('Zahlen-Normalisierung und Bindung', () => {
  test('deutsche und englische Schreibweisen treffen denselben Wert', () => {
    expect(normalizeNumericLiteral('1.200')).toBe(1200);
    expect(normalizeNumericLiteral('1,200')).toBe(1200);
    expect(normalizeNumericLiteral('3,5')).toBe(3.5);
    expect(normalizeNumericLiteral('3.5')).toBe(3.5);
  });

  test('"1.200 Nutzer" ist an einen Beleg mit "1200" gebunden', () => {
    const claims = extractVerifiableClaims('Wir haben 1.200 Nutzer erreicht.');
    expect(claims).toHaveLength(1);
    expect(
      isClaimBound(claims[0], [{ id: 'p', type: 'metric', content: 'Reichweite: 1200 Nutzer' }])
    ).toBe(true);
  });

  test('sprachliche Vergleiche brauchen ebenfalls einen Beleg', () => {
    const claims = extractVerifiableClaims('Der Prozess läuft jetzt doppelt so schnell.');
    expect(claims.some((claim) => claim.kind === 'comparative')).toBe(true);
    expect(isClaimBound(claims[0], [])).toBe(false);
  });
});

describe('Zustimmungs-Regel', () => {
  test('fehlende Spalte (vor Migration 016) macht Belege nicht unbrauchbar', () => {
    expect(isProofAssetEligible({ id: 'p', type: 'metric', content: 'x' })).toBe(true);
  });

  test('ausdrücklich verweigerte Zustimmung schließt den Beleg aus', () => {
    expect(
      isProofAssetEligible({ id: 'p', type: 'customer_quote', content: 'x', consentStatus: 'denied' })
    ).toBe(false);
  });

  test('Kundenzitat ohne jede Angabe zählt nicht, eigene Metrik schon', () => {
    expect(
      isProofAssetEligible({ id: 'p', type: 'customer_quote', content: 'x', consentStatus: null })
    ).toBe(false);
    expect(
      isProofAssetEligible({ id: 'p', type: 'metric', content: 'x', consentStatus: null })
    ).toBe(true);
  });
});
