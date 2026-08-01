// Der geführte Faden ("von Schritt zu Schritt weitergereicht werden").
//
// Warum diese Datei rein und DB-frei ist: die Reihenfolge der Schritte IST die
// Produktentscheidung. Läge sie in der UI verstreut, wäre sie weder testbar
// noch an einer Stelle änderbar. Der Loader (`load.ts`) beschafft nur Zahlen,
// diese Datei entscheidet daraus, wo der Nutzer als Nächstes hin soll.
//
// Das Dashboard hat sechs gleichrangige Wege, einen Post zu erzeugen (Start,
// Compose, Templates, Content Hub, Fabrik, Writer). Der Faden kürt bewusst
// EINEN Hauptweg — /publish/start — und lässt die anderen als Nebeneingänge
// bestehen, statt sie zu entfernen.

export type GuideStepId = 'product' | 'connect' | 'create' | 'approve' | 'schedule' | 'results';

export interface GuideState {
  hasProduct: boolean;
  activeConnections: number;
  /** Immer 0, wenn `writerAvailable` false ist — dann fehlt die Tabelle. */
  awaitingApproval: number;
  /** False, solange die Writer-Migrationen (020–022) nicht live sind. */
  writerAvailable: boolean;
  drafts: number;
  scheduled: number;
  published: number;
}

export interface GuideStep {
  id: GuideStepId;
  href: string;
  done: boolean;
  /** Es wartet etwas aktiv auf eine Entscheidung des Nutzers. */
  urgent: boolean;
  /** Wird neben dem Label gezeigt, wenn > 0. */
  count: number;
}

export interface GuideResolution {
  steps: GuideStep[];
  current: GuideStep;
  /** 1-basierte Position von `current` in `steps`. */
  position: number;
  total: number;
  /** Alle Schritte erledigt — der Faden beginnt beim nächsten Post von vorn. */
  complete: boolean;
}

const HREFS: Record<GuideStepId, string> = {
  product: '/product',
  connect: '/connections',
  create: '/publish/start',
  approve: '/publish/writer',
  schedule: '/publish/calendar',
  results: '/publish/posts',
};

const FULL_ORDER: GuideStepId[] = [
  'product',
  'connect',
  'create',
  'approve',
  'schedule',
  'results',
];

/** Schritte, ohne die kein späterer Schritt funktionieren kann. */
const SETUP_STEPS: GuideStepId[] = ['product', 'connect'];

export function resolveGuide(state: GuideState): GuideResolution {
  // Ohne Writer-Migrationen gäbe es einen Schritt, der dauerhaft "erledigt"
  // aussieht, obwohl es ihn gar nicht gibt. Dann lieber ganz weglassen.
  const order = FULL_ORDER.filter((id) => id !== 'approve' || state.writerAvailable);

  const awaiting = state.writerAvailable ? state.awaitingApproval : 0;
  const anyPost = state.drafts + state.scheduled + state.published;

  const done: Record<GuideStepId, boolean> = {
    product: state.hasProduct,
    connect: state.activeConnections > 0,
    // Ein wartender Writer-Entwurf zählt als "geschrieben" — er liegt nur noch
    // nicht als post_group vor, sondern als content_item.
    create: anyPost > 0 || awaiting > 0,
    approve: awaiting === 0,
    schedule: state.scheduled + state.published > 0,
    results: state.published > 0,
  };

  const counts: Record<GuideStepId, number> = {
    product: 0,
    connect: state.activeConnections,
    create: state.drafts,
    approve: awaiting,
    schedule: state.scheduled,
    results: state.published,
  };

  const steps: GuideStep[] = order.map((id) => ({
    id,
    href: HREFS[id],
    done: done[id],
    urgent: id === 'approve' && awaiting > 0,
    count: counts[id],
  }));

  // Reihenfolge der Vorfahrt:
  // 1. Setup-Lücke — ohne Produkt oder Kanal läuft nichts anderes sinnvoll.
  // 2. Wartende Freigabe — der Post ist fertig, alles andere steht still.
  // 3. Erster offener Schritt in Reihenfolge.
  const setupGap = steps.find((step) => SETUP_STEPS.includes(step.id) && !step.done);
  const waiting = steps.find((step) => step.urgent);
  const firstOpen = steps.find((step) => !step.done);
  const complete = firstOpen === undefined;

  // Ist alles erledigt, ist der nächste sinnvolle Schritt der nächste Post —
  // der Faden ist eine Schleife, keine Einbahnstraße.
  const createStep = steps.find((step) => step.id === 'create');
  const current = setupGap ?? waiting ?? firstOpen ?? createStep;

  // `create` steht in FULL_ORDER und wird nie herausgefiltert, daher kann
  // `current` hier nicht undefined sein. Der Guard hält den Typ ehrlich.
  if (!current) {
    throw new Error('[guide] no resolvable step — step order is empty');
  }

  return {
    steps,
    current,
    position: steps.indexOf(current) + 1,
    total: steps.length,
    complete,
  };
}
