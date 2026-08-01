import { describe, expect, test } from 'vitest';
import { resolveGuide, type GuideState } from '@/lib/guide/steps';

const EMPTY: GuideState = {
  hasProduct: false,
  activeConnections: 0,
  awaitingApproval: 0,
  writerAvailable: true,
  drafts: 0,
  scheduled: 0,
  published: 0,
};

function state(overrides: Partial<GuideState> = {}): GuideState {
  return { ...EMPTY, ...overrides };
}

describe('geführter Faden — Reihenfolge', () => {
  test('ein leerer Workspace startet beim Produktprofil', () => {
    const guide = resolveGuide(EMPTY);
    expect(guide.current.id).toBe('product');
    expect(guide.position).toBe(1);
    expect(guide.complete).toBe(false);
  });

  test('mit Produkt, aber ohne Kanal folgt die Kanalverbindung', () => {
    expect(resolveGuide(state({ hasProduct: true })).current.id).toBe('connect');
  });

  test('nach dem Setup ist das Erstellen dran', () => {
    const guide = resolveGuide(state({ hasProduct: true, activeConnections: 1 }));
    expect(guide.current.id).toBe('create');
    expect(guide.current.href).toBe('/publish/start');
  });

  test('ein Entwurf schiebt den Faden auf den Termin weiter', () => {
    const guide = resolveGuide(state({ hasProduct: true, activeConnections: 1, drafts: 1 }));
    expect(guide.current.id).toBe('schedule');
  });

  test('ein geplanter Post führt zum Ergebnis-Schritt', () => {
    const guide = resolveGuide(state({ hasProduct: true, activeConnections: 1, scheduled: 1 }));
    expect(guide.current.id).toBe('results');
  });
});

describe('geführter Faden — Vorfahrt', () => {
  test('eine wartende Freigabe überholt spätere Schritte', () => {
    const guide = resolveGuide(
      state({ hasProduct: true, activeConnections: 1, awaitingApproval: 1 })
    );
    expect(guide.current.id).toBe('approve');
    expect(guide.current.urgent).toBe(true);
    expect(guide.current.count).toBe(1);
  });

  test('eine wartende Freigabe zählt als geschriebener Post', () => {
    const guide = resolveGuide(
      state({ hasProduct: true, activeConnections: 1, awaitingApproval: 1 })
    );
    expect(guide.steps.find((step) => step.id === 'create')?.done).toBe(true);
  });

  // Sonst schickt der Faden in eine Freigabe, die ohne Kanal nicht
  // veröffentlicht werden kann.
  test('eine Setup-Lücke schlägt selbst eine wartende Freigabe', () => {
    const guide = resolveGuide(state({ hasProduct: true, awaitingApproval: 1 }));
    expect(guide.current.id).toBe('connect');
  });
});

describe('geführter Faden — Writer nicht verfügbar', () => {
  test('ohne Writer-Migrationen entfällt der Freigabe-Schritt komplett', () => {
    const guide = resolveGuide(state({ writerAvailable: false }));
    expect(guide.steps.map((step) => step.id)).not.toContain('approve');
    expect(guide.total).toBe(5);
  });

  test('ein Zählerrest wird ignoriert, wenn der Writer fehlt', () => {
    const guide = resolveGuide(
      state({
        hasProduct: true,
        activeConnections: 1,
        writerAvailable: false,
        awaitingApproval: 7,
      })
    );
    expect(guide.current.id).toBe('create');
    expect(guide.steps.every((step) => !step.urgent)).toBe(true);
  });

  test('mit Writer sind es sechs Schritte', () => {
    expect(resolveGuide(EMPTY).total).toBe(6);
  });
});

describe('geführter Faden — Schleife', () => {
  const finished = state({
    hasProduct: true,
    activeConnections: 1,
    scheduled: 1,
    published: 1,
  });

  test('ein veröffentlichter Post schließt den Faden', () => {
    const guide = resolveGuide(finished);
    expect(guide.complete).toBe(true);
    expect(guide.steps.every((step) => step.done)).toBe(true);
  });

  test('nach dem Abschluss zeigt der Faden zurück auf den nächsten Post', () => {
    expect(resolveGuide(finished).current.id).toBe('create');
  });

  test('eine neue Freigabe reißt den abgeschlossenen Faden wieder auf', () => {
    const guide = resolveGuide({ ...finished, awaitingApproval: 2 });
    expect(guide.complete).toBe(false);
    expect(guide.current.id).toBe('approve');
    expect(guide.current.count).toBe(2);
  });
});

describe('geführter Faden — Invarianten', () => {
  test('`current` ist immer Teil von `steps` und `position` zeigt darauf', () => {
    const cases: GuideState[] = [
      EMPTY,
      state({ hasProduct: true }),
      state({ hasProduct: true, activeConnections: 2 }),
      state({ hasProduct: true, activeConnections: 1, awaitingApproval: 1 }),
      state({ hasProduct: true, activeConnections: 1, drafts: 3 }),
      state({ hasProduct: true, activeConnections: 1, scheduled: 1, published: 4 }),
      state({ writerAvailable: false }),
      state({ writerAvailable: false, hasProduct: true, activeConnections: 1, published: 1 }),
    ];

    for (const input of cases) {
      const guide = resolveGuide(input);
      expect(guide.steps).toContain(guide.current);
      expect(guide.steps[guide.position - 1]).toBe(guide.current);
      expect(guide.position).toBeGreaterThanOrEqual(1);
      expect(guide.position).toBeLessThanOrEqual(guide.total);
      expect(guide.steps).toHaveLength(guide.total);
    }
  });

  test('jeder Schritt hat ein Ziel, das im Dashboard existiert', () => {
    const known = [
      '/product',
      '/connections',
      '/publish/start',
      '/publish/writer',
      '/publish/calendar',
      '/publish/posts',
    ];
    for (const step of resolveGuide(EMPTY).steps) {
      expect(known).toContain(step.href);
    }
  });
});
