// Zustandsmaschine der Content-Fabrik (Plan 2 / 2B.1, §2).
//
// Zwei Regeln stehen hier auf dem Prüfstand:
//   1. Jeder Übergang schreibt Grund UND Verursacher. Ein `rejected` ohne
//      Grund ist ein Bug, kein Zustand.
//   2. Kein Item bleibt in einem Zwischenzustand hängen (Failure Mode §8).
import { describe, expect, test } from 'vitest';
import { ApiError } from '@/lib/api/http';
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  CONTENT_ITEM_STATES,
  isStalled,
  isStale,
  STATE_TIMEOUT_MINUTES,
  TERMINAL_STATES,
  type ContentItemState,
} from '@/lib/pipeline/state';

describe('Übergangsregeln', () => {
  test('der Glücksfall läuft signal → measured durch', () => {
    const happyPath: ContentItemState[] = [
      'signal',
      'angled',
      'concepted',
      'drafted',
      'gated',
      'scheduled',
      'published',
      'measured',
    ];
    for (let index = 0; index < happyPath.length - 1; index++) {
      expect(canTransition(happyPath[index], happyPath[index + 1]), `${happyPath[index]}`).toBe(true);
    }
  });

  test('aus jedem Zwischenzustand ist rejected erreichbar', () => {
    for (const state of ['signal', 'angled', 'concepted', 'drafted', 'gated'] as ContentItemState[]) {
      expect(canTransition(state, 'rejected'), state).toBe(true);
    }
  });

  test('Sprünge über Zustände hinweg sind verboten', () => {
    expect(canTransition('signal', 'drafted')).toBe(false);
    expect(canTransition('concepted', 'scheduled')).toBe(false);
    expect(canTransition('drafted', 'published')).toBe(false);
  });

  test('terminale Zustände haben keinen Ausgang', () => {
    for (const state of TERMINAL_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toEqual([]);
    }
  });

  test('ein blockiertes Gate wirft auf drafted zurück statt zu verschwinden', () => {
    expect(canTransition('gated', 'drafted')).toBe(true);
    expect(canTransition('drafted', 'drafted')).toBe(true);
  });

  test('jeder Zustand ist in der Übergangstabelle abgedeckt', () => {
    for (const state of CONTENT_ITEM_STATES) {
      expect(ALLOWED_TRANSITIONS[state], state).toBeDefined();
    }
  });
});

describe('kein Übergang ohne Grund und Verursacher', () => {
  test('rejected ohne Grund wird abgelehnt', () => {
    expect(() =>
      assertTransition('drafted', { to: 'rejected', reason: '', actor: 'system' })
    ).toThrowError(ApiError);
    try {
      assertTransition('drafted', { to: 'rejected', reason: '   ', actor: 'user' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('transition_reason_required');
    }
  });

  test('auch ein regulärer Übergang braucht einen Grund', () => {
    expect(() =>
      assertTransition('signal', { to: 'angled', reason: '', actor: 'system' })
    ).toThrowError(/reason/i);
  });

  test('ein unbekannter Verursacher wird abgelehnt', () => {
    expect(() =>
      assertTransition('signal', {
        to: 'angled',
        reason: 'ok',
        actor: 'robot' as unknown as 'system',
      })
    ).toThrowError(/actor/i);
  });

  test('ein unerlaubter Übergang liefert 409 statt still zu scheitern', () => {
    try {
      assertTransition('signal', { to: 'published', reason: 'weil', actor: 'user' });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).code).toBe('invalid_transition');
    }
  });

  test('ein gültiger Übergang mit Grund geht durch', () => {
    expect(() =>
      assertTransition('drafted', {
        to: 'gated',
        reason: 'Gate bestanden: 2/2 Varianten',
        actor: 'system',
      })
    ).not.toThrow();
  });
});

describe('Hängenbleiben wird erkannt (§8)', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');

  test('ein frisches Item gilt nicht als hängengeblieben', () => {
    expect(
      isStalled({ state: 'concepted', state_entered_at: '2026-07-25T11:30:00.000Z' }, now)
    ).toBe(false);
  });

  test('ein Item über dem Timeout seines Zustands gilt als hängengeblieben', () => {
    // concepted: 120 Minuten
    expect(
      isStalled({ state: 'concepted', state_entered_at: '2026-07-25T09:00:00.000Z' }, now)
    ).toBe(true);
  });

  test('Wartezustände haben bewusst kein Timeout', () => {
    for (const state of ['scheduled', 'published', 'measured', 'rejected'] as ContentItemState[]) {
      expect(STATE_TIMEOUT_MINUTES[state]).toBeUndefined();
      expect(isStalled({ state, state_entered_at: '2020-01-01T00:00:00.000Z' }, now)).toBe(false);
    }
  });

  test('jeder Arbeitszustand hat ein Timeout', () => {
    for (const state of ['signal', 'angled', 'concepted', 'drafted', 'gated'] as ContentItemState[]) {
      expect(STATE_TIMEOUT_MINUTES[state], state).toBeGreaterThan(0);
    }
  });
});

describe('kalte Signale', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');

  test('ohne stale_after wird nichts kalt', () => {
    expect(isStale({ stale_after: null }, now)).toBe(false);
  });

  test('nach stale_after ist das Signal kalt', () => {
    expect(isStale({ stale_after: '2026-07-24T12:00:00.000Z' }, now)).toBe(true);
    expect(isStale({ stale_after: '2026-07-26T12:00:00.000Z' }, now)).toBe(false);
  });
});
