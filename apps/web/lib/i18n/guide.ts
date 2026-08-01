// Texte für den geführten Faden. Gleiches Muster wie `creator-style.ts` und
// `product.ts`: eine selbstständige Datei, alle drei Locales, getippte Keys —
// ein neuer Key erzwingt DE/EN/ES gemeinsam (GOAL-RUN5 T1).
import type { AppLocale } from '@prolora/shared';
import type { GuideStepId } from '@/lib/guide/steps';

interface StepCopy {
  /** Kurzname in der Schrittliste. */
  label: string;
  /** Ein Satz: was hier zu tun ist. */
  hint: string;
  /** Beschriftung des Weiter-Buttons. */
  cta: string;
}

export interface GuideCopy {
  bar_label: string;
  /** Platzhalter "{current}" und "{total}". */
  step_of: string;
  you_are_here: string;
  show_all: string;
  hide_all: string;
  done_label: string;
  waiting_label: string;
  complete_label: string;
  complete_hint: string;
  complete_cta: string;
  steps: Record<GuideStepId, StepCopy>;
}

const COPY: Record<AppLocale, GuideCopy> = {
  de: {
    bar_label: 'Nächster Schritt',
    step_of: 'Schritt {current} von {total}',
    you_are_here: 'Du bist hier',
    show_all: 'Alle Schritte',
    hide_all: 'Schritte ausblenden',
    done_label: 'Erledigt',
    waiting_label: 'Wartet auf dich',
    complete_label: 'Alles erledigt',
    complete_hint: 'Dein Post ist draußen. Weiter geht es mit dem nächsten.',
    complete_cta: 'Nächsten Post schreiben',
    steps: {
      product: {
        label: 'Produkt beschreiben',
        hint: 'Sag einmal, worum es geht — daraus zieht Prolora jeden späteren Vorschlag.',
        cta: 'Produkt beschreiben',
      },
      connect: {
        label: 'Kanal verbinden',
        hint: 'Ohne verbundenen Kanal kann nichts veröffentlicht werden.',
        cta: 'Kanal verbinden',
      },
      create: {
        label: 'Post erstellen',
        hint: 'Ziel wählen, Blickwinkel bestätigen, Entwurf bekommen.',
        cta: 'Post erstellen',
      },
      approve: {
        label: 'Freigeben',
        hint: 'Ein fertiger Entwurf wartet auf deine Entscheidung.',
        cta: 'Jetzt ansehen',
      },
      schedule: {
        label: 'Termin setzen',
        hint: 'Leg fest, wann der Post rausgeht.',
        cta: 'Termin setzen',
      },
      results: {
        label: 'Ergebnis ansehen',
        hint: 'Schau nach, was der veröffentlichte Post gebracht hat.',
        cta: 'Ergebnis ansehen',
      },
    },
  },
  en: {
    bar_label: 'Next step',
    step_of: 'Step {current} of {total}',
    you_are_here: 'You are here',
    show_all: 'All steps',
    hide_all: 'Hide steps',
    done_label: 'Done',
    waiting_label: 'Waiting for you',
    complete_label: 'All done',
    complete_hint: 'Your post is out. On to the next one.',
    complete_cta: 'Write the next post',
    steps: {
      product: {
        label: 'Describe your product',
        hint: 'Say once what this is about — every later suggestion is drawn from it.',
        cta: 'Describe product',
      },
      connect: {
        label: 'Connect a channel',
        hint: 'Nothing can be published until one channel is connected.',
        cta: 'Connect channel',
      },
      create: {
        label: 'Create a post',
        hint: 'Pick a goal, confirm an angle, get a draft.',
        cta: 'Create post',
      },
      approve: {
        label: 'Approve',
        hint: 'A finished draft is waiting for your decision.',
        cta: 'Review now',
      },
      schedule: {
        label: 'Set a time',
        hint: 'Decide when the post goes out.',
        cta: 'Set a time',
      },
      results: {
        label: 'See results',
        hint: 'Check what the published post actually did.',
        cta: 'See results',
      },
    },
  },
  es: {
    bar_label: 'Siguiente paso',
    step_of: 'Paso {current} de {total}',
    you_are_here: 'Estás aquí',
    show_all: 'Todos los pasos',
    hide_all: 'Ocultar pasos',
    done_label: 'Hecho',
    waiting_label: 'Te está esperando',
    complete_label: 'Todo hecho',
    complete_hint: 'Tu publicación ya salió. Vamos con la siguiente.',
    complete_cta: 'Escribir la siguiente',
    steps: {
      product: {
        label: 'Describe tu producto',
        hint: 'Dilo una vez — de ahí sale cada sugerencia posterior.',
        cta: 'Describir producto',
      },
      connect: {
        label: 'Conecta un canal',
        hint: 'Sin un canal conectado no se puede publicar nada.',
        cta: 'Conectar canal',
      },
      create: {
        label: 'Crea una publicación',
        hint: 'Elige un objetivo, confirma un enfoque y recibe un borrador.',
        cta: 'Crear publicación',
      },
      approve: {
        label: 'Aprobar',
        hint: 'Un borrador terminado espera tu decisión.',
        cta: 'Revisar ahora',
      },
      schedule: {
        label: 'Programa la hora',
        hint: 'Decide cuándo se publica.',
        cta: 'Programar',
      },
      results: {
        label: 'Ver resultados',
        hint: 'Mira qué consiguió la publicación.',
        cta: 'Ver resultados',
      },
    },
  },
};

export function getGuideCopy(locale: AppLocale): GuideCopy {
  return COPY[locale];
}

/** Ersetzt "{current}"/"{total}" — dieselbe Konvention wie `step_of` im Wizard. */
export function formatStepOf(template: string, current: number, total: number): string {
  return template.replace('{current}', String(current)).replace('{total}', String(total));
}
