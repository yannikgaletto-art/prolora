'use client';

// Web Speech dictation (GOAL-RUN5 G3/D3). Browser-native SpeechRecognition —
// no audio ever reaches Prolora servers (Chrome/Edge send it to their vendor
// cloud; the one-time privacy notice in TemplateGuide says so). Final-only
// results by design: interim text flickering inside a form field reads as
// broken. One recording at a time (V4.6); Escape stops it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppLocale } from '@prolora/shared';

// lib.dom ships no SpeechRecognition types (it is still vendor-prefixed in
// Chromium) — minimal structural typings instead of `any`.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** UI locale → recognition language (posts are dictated in the UI language). */
const SPEECH_LANG: Record<AppLocale, string> = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
};

export type SpeechTransientError = 'no-speech' | 'network';

export interface SpeechInput {
  /** false on Firefox and old browsers — hide the mic entirely (D3). */
  supported: boolean;
  /** Slot key currently recording, or null. */
  activeKey: string | null;
  /** Permission denied — the mic stays hidden for the rest of the session. */
  blocked: boolean;
  /** One-shot error for the caller to surface (hint or toast), then dismiss. */
  transientError: SpeechTransientError | null;
  dismissError: () => void;
  start: (key: string, onFinal: (text: string) => void) => void;
  stop: () => void;
}

export function useSpeechInput(locale: AppLocale): SpeechInput {
  // Feature detection must run client-side only — start with false so the
  // server render and the first client render agree (no hydration mismatch).
  const [supported, setSupported] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [transientError, setTransientError] = useState<SpeechTransientError | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== undefined);
  }, []);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    []
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setActiveKey(null);
  }, []);

  const start = useCallback(
    (key: string, onFinal: (text: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor || blocked) return;
      // Exclusive recording: starting on one field silently ends the other.
      recognitionRef.current?.abort();
      setTransientError(null);

      const recognition = new Ctor();
      recognition.lang = SPEECH_LANG[locale];
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result?.isFinal && result[0]) {
            const text = result[0].transcript.trim();
            if (text) onFinal(text);
          }
        }
      };
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setBlocked(true);
        } else if (event.error === 'no-speech') {
          setTransientError('no-speech');
        } else if (event.error === 'network') {
          setTransientError('network');
        }
        // 'aborted' and friends: the onend handler cleans up.
      };
      recognition.onend = () => {
        // Only clear if a newer recording hasn't replaced this instance.
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
          setActiveKey(null);
        }
      };

      recognitionRef.current = recognition;
      setActiveKey(key);
      try {
        recognition.start();
      } catch {
        // Safari throws on rapid restart — treat as a silent no-op.
        recognitionRef.current = null;
        setActiveKey(null);
      }
    },
    [blocked, locale]
  );

  useEffect(() => {
    if (activeKey === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeKey, stop]);

  const dismissError = useCallback(() => setTransientError(null), []);

  return { supported, activeKey, blocked, transientError, dismissError, start, stop };
}
