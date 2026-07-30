import type { AppLocale } from '@prolora/shared';
import type { WriterConfidenceTier, WriterSection } from './writer-model';

export interface WriterCopy {
  eyebrow: string;
  title: string;
  subtitle: string;
  pilot: string;
  approvalPromise: string;
  sections: Record<WriterSection, string>;
  status: {
    active: string;
    paused: string;
    approvalRequired: string;
    shadow: string;
  };
  stats: {
    awaiting: string;
    preparing: string;
    learned: string;
    exceptions: string;
  };
  actions: {
    pause: string;
    resume: string;
    runShadow: string;
    running: string;
    approve: string;
    approving: string;
    edit: string;
    saveEdit: string;
    alternate: string;
    reject: string;
    cancel: string;
    retry: string;
  };
  setup: {
    migrationTitle: string;
    migrationBody: string;
    setupTitle: string;
    setupBody: string;
    unavailableTitle: string;
    unavailableBody: string;
    safeNote: string;
  };
  today: {
    queueTitle: string;
    queueReady: string;
    emptyTitle: string;
    emptyBody: string;
    pausedBody: string;
  };
  review: {
    recommended: string;
    whyNow: string;
    channels: string;
    schedule: string;
    localTime: string;
    utcTime: string;
    exactPreview: string;
    threadPart: string;
    media: string;
    altText: string;
    firstComment: string;
    sources: string;
    verified: string;
    unverified: string;
    gate: string;
    gatePassed: string;
    gateBlocked: string;
    warnings: string;
    skipped: string;
    overrides: string;
    changes: string;
    snapshot: string;
    selectedChannels: string;
    approvalHint: string;
    editTitle: string;
    rejectTitle: string;
    rejectReason: string;
    rejectDetails: string;
    rejectionReasons: Record<'off_brand' | 'weak_evidence' | 'wrong_timing' | 'other', string>;
  };
  dna: {
    title: string;
    subtitle: string;
    version: string;
    samples: string;
    golden: string;
    avoid: string;
    traits: string;
    noTraits: string;
    lockedRules: string;
    noLockedRules: string;
    lockedHint: string;
    rebuild: string;
    rebuilding: string;
    addSample: string;
    sampleKind: string;
    sampleOrigin: string;
    sampleLabel: string;
    sampleContent: string;
    sampleUrl: string;
    publishedPost: string;
    add: string;
    adding: string;
    origins: Record<'pasted' | 'imported' | 'published', string>;
    confidence: Record<WriterConfidenceTier, string> & {
      lowHint: string;
      preliminaryHint: string;
      reliableHint: string;
      preciseHint: string;
    };
  };
  history: {
    title: string;
    subtitle: string;
    emptyTitle: string;
    emptyBody: string;
    statuses: Record<'approved' | 'rejected' | 'invalidated' | 'expired' | 'pending', string>;
  };
  feedback: {
    policyUpdated: string;
    runStarted: string;
    approved: string;
    edited: string;
    alternateStarted: string;
    rejected: string;
    sampleAdded: string;
    rebuildStarted: string;
  };
}

const en: WriterCopy = {
  eyebrow: 'Approval-first autopilot',
  title: 'Your next post, already thought through.',
  subtitle:
    'Writer turns trusted signals into one grounded, channel-native recommendation. Nothing ships without your personal approval.',
  pilot: 'Pilot',
  approvalPromise: 'Every post stops here for your final decision.',
  sections: { today: 'Today', dna: 'Content DNA', history: 'History' },
  status: {
    active: 'Writer active',
    paused: 'Writer paused',
    approvalRequired: 'Approval required',
    shadow: 'Shadow mode',
  },
  stats: {
    awaiting: 'Awaiting approval',
    preparing: 'Preparing',
    learned: 'Golden Samples learned',
    exceptions: 'Needs your help',
  },
  actions: {
    pause: 'Pause Writer',
    resume: 'Resume Writer',
    runShadow: 'Run once in Shadow mode',
    running: 'Preparing recommendation…',
    approve: 'Approve & schedule',
    approving: 'Approving…',
    edit: 'Edit',
    saveEdit: 'Request revised review',
    alternate: 'Try another direction',
    reject: 'Reject',
    cancel: 'Cancel',
    retry: 'Try again',
  },
  setup: {
    migrationTitle: 'Writer is safely paused for setup',
    migrationBody:
      'The Writer storage is not installed yet. Your existing Publish tools remain available and unchanged.',
    setupTitle: 'Teach Writer what good sounds like',
    setupBody:
      'Add at least three Golden Samples to create a preliminary Content DNA. Five or more make the profile meaningfully reliable.',
    unavailableTitle: 'Writer is temporarily unavailable',
    unavailableBody:
      'We could not load the pilot safely. Writer remains paused and no content has been scheduled.',
    safeNote: 'No post can be published from this state.',
  },
  today: {
    queueTitle: 'Today’s recommendation',
    queueReady: 'Ready for your final review',
    emptyTitle: 'Nothing waiting for approval',
    emptyBody: 'Run Writer once, or return when the next recommendation is ready.',
    pausedBody: 'Automatic runs are paused. You can still run one safe Shadow recommendation.',
  },
  review: {
    recommended: 'Recommended',
    whyNow: 'Why now',
    channels: 'Channel previews',
    schedule: 'Proposed schedule',
    localTime: 'Local',
    utcTime: 'UTC',
    exactPreview: 'Exact post',
    threadPart: 'Part',
    media: 'Media',
    altText: 'Alt text',
    firstComment: 'First comment',
    sources: 'Claims & sources',
    verified: 'Verified',
    unverified: 'Needs verification',
    gate: 'Quality gate',
    gatePassed: 'All hard checks passed',
    gateBlocked: 'A selected channel needs attention',
    warnings: 'Warnings',
    skipped: 'Skipped checks',
    overrides: 'Overrides',
    changes: 'Changes since last review',
    snapshot: 'Approval snapshot',
    selectedChannels: 'Selected channels',
    approvalHint:
      'Approval binds this exact copy, media, destination, timing, sources and policy versions.',
    editTitle: 'Edit exact channel copy',
    rejectTitle: 'Why is this not right?',
    rejectReason: 'Reason',
    rejectDetails: 'Optional note',
    rejectionReasons: {
      off_brand: 'Does not sound like us',
      weak_evidence: 'Evidence is not strong enough',
      wrong_timing: 'Wrong topic or timing',
      other: 'Other',
    },
  },
  dna: {
    title: 'Content DNA',
    subtitle: 'Versioned style guidance learned only from samples you intentionally choose.',
    version: 'Version',
    samples: 'Active samples',
    golden: 'Golden',
    avoid: 'Avoid',
    traits: 'Learned traits',
    noTraits: 'Traits appear after enough Golden Samples are available.',
    lockedRules: 'Locked rules',
    noLockedRules: 'No rules are locked yet.',
    lockedHint: 'Locked rules cannot be overwritten by later learning.',
    rebuild: 'Rebuild Content DNA',
    rebuilding: 'Rebuilding…',
    addSample: 'Add a sample',
    sampleKind: 'This is a',
    sampleOrigin: 'Source',
    sampleLabel: 'Label',
    sampleContent: 'Post text',
    sampleUrl: 'Source URL',
    publishedPost: 'Published post item ID',
    add: 'Add sample',
    adding: 'Adding…',
    origins: { pasted: 'Paste text', imported: 'Imported source', published: 'Published post' },
    confidence: {
      low: 'Low confidence',
      preliminary: 'Preliminary profile',
      reliable: 'Reliable profile',
      precise: 'High-detail profile',
      lowHint: 'Add more Golden Samples before relying on style guidance.',
      preliminaryHint: 'Soft preferences only; more Golden Samples will stabilize the profile.',
      reliableHint: 'Enough evidence for dependable guidance, still not a guarantee.',
      preciseHint: 'Rich sample coverage; Writer still treats this as guidance, not fact.',
    },
  },
  history: {
    title: 'Review history',
    subtitle: 'A quiet audit trail of approvals, edits, rejections and invalidations.',
    emptyTitle: 'No Writer history yet',
    emptyBody: 'Your review decisions will appear here without changing existing Posts history.',
    statuses: {
      approved: 'Approved',
      rejected: 'Rejected',
      invalidated: 'Invalidated',
      expired: 'Expired',
      pending: 'Pending',
    },
  },
  feedback: {
    policyUpdated: 'Writer policy updated.',
    runStarted: 'Shadow recommendation started.',
    approved: 'Approved and safely handed to scheduling.',
    edited: 'Change request recorded. The previous review is now invalidated.',
    alternateStarted: 'Alternate direction requested. The previous review is now invalidated.',
    rejected: 'Recommendation rejected.',
    sampleAdded: 'Sample added intentionally.',
    rebuildStarted: 'A new Content DNA version is being built.',
  },
};

const de: WriterCopy = {
  ...en,
  eyebrow: 'Autopilot mit Freigabe',
  title: 'Dein nächster Post – schon zu Ende gedacht.',
  subtitle:
    'Writer macht aus vertrauenswürdigen Signalen genau eine belegte, kanalnative Empfehlung. Ohne deine persönliche Freigabe geht nichts raus.',
  approvalPromise: 'Jeder Post stoppt hier für deine finale Entscheidung.',
  sections: { today: 'Heute', dna: 'Content DNA', history: 'Verlauf' },
  status: {
    active: 'Writer aktiv',
    paused: 'Writer pausiert',
    approvalRequired: 'Freigabe erforderlich',
    shadow: 'Shadow-Modus',
  },
  stats: {
    awaiting: 'Wartet auf Freigabe',
    preparing: 'Wird vorbereitet',
    learned: 'Golden Samples gelernt',
    exceptions: 'Braucht deine Hilfe',
  },
  actions: {
    pause: 'Writer pausieren',
    resume: 'Writer fortsetzen',
    runShadow: 'Einmal im Shadow-Modus starten',
    running: 'Empfehlung wird vorbereitet…',
    approve: 'Freigeben & einplanen',
    approving: 'Wird freigegeben…',
    edit: 'Ändern',
    saveEdit: 'Überarbeitete Review anfordern',
    alternate: 'Andere Idee',
    reject: 'Ablehnen',
    cancel: 'Abbrechen',
    retry: 'Erneut versuchen',
  },
  setup: {
    migrationTitle: 'Writer wartet sicher auf die Einrichtung',
    migrationBody:
      'Der Writer-Speicher ist noch nicht installiert. Deine bestehenden Publish-Werkzeuge bleiben unverändert verfügbar.',
    setupTitle: 'Zeig Writer, wie gute Inhalte klingen',
    setupBody:
      'Mit drei Golden Samples entsteht eine vorläufige Content DNA. Ab fünf Samples wird das Profil sinnvoll belastbar.',
    unavailableTitle: 'Writer ist vorübergehend nicht verfügbar',
    unavailableBody:
      'Der Pilot konnte nicht sicher geladen werden. Writer bleibt pausiert und plant keine Inhalte ein.',
    safeNote: 'Aus diesem Zustand kann kein Post veröffentlicht werden.',
  },
  today: {
    queueTitle: 'Heutige Empfehlung',
    queueReady: 'Bereit für deine finale Prüfung',
    emptyTitle: 'Keine Freigabe offen',
    emptyBody: 'Starte Writer einmal oder komm zurück, sobald die nächste Empfehlung bereit ist.',
    pausedBody:
      'Automatische Läufe sind pausiert. Eine sichere Shadow-Empfehlung kannst du trotzdem starten.',
  },
  review: {
    ...en.review,
    recommended: 'Empfohlen',
    whyNow: 'Warum jetzt',
    channels: 'Kanalvorschauen',
    schedule: 'Vorgeschlagener Termin',
    localTime: 'Lokal',
    exactPreview: 'Exakter Post',
    threadPart: 'Teil',
    media: 'Medien',
    altText: 'Alternativtext',
    firstComment: 'Erster Kommentar',
    sources: 'Aussagen & Quellen',
    verified: 'Belegt',
    unverified: 'Prüfung erforderlich',
    gate: 'Quality Gate',
    gatePassed: 'Alle harten Prüfungen bestanden',
    gateBlocked: 'Ein ausgewählter Kanal braucht Aufmerksamkeit',
    warnings: 'Warnungen',
    skipped: 'Übersprungene Prüfungen',
    overrides: 'Übersteuerungen',
    changes: 'Änderungen seit der letzten Review',
    snapshot: 'Freigabe-Snapshot',
    selectedChannels: 'Ausgewählte Kanäle',
    approvalHint:
      'Die Freigabe bindet exakt diesen Text, Medien, Ziel, Zeitpunkt, Quellen und Policy-Versionen.',
    editTitle: 'Exakten Kanaltext ändern',
    rejectTitle: 'Warum passt die Empfehlung nicht?',
    rejectReason: 'Grund',
    rejectDetails: 'Optionale Notiz',
    rejectionReasons: {
      off_brand: 'Klingt nicht nach uns',
      weak_evidence: 'Belege sind nicht stark genug',
      wrong_timing: 'Falsches Thema oder Timing',
      other: 'Sonstiges',
    },
  },
  dna: {
    ...en.dna,
    title: 'Content DNA',
    subtitle: 'Versionierte Stilregeln – nur aus Samples, die du bewusst auswählst.',
    version: 'Version',
    samples: 'Aktive Samples',
    golden: 'Golden',
    avoid: 'Vermeiden',
    traits: 'Gelernte Merkmale',
    noTraits: 'Merkmale erscheinen, sobald genug Golden Samples vorliegen.',
    lockedRules: 'Gesperrte Regeln',
    noLockedRules: 'Noch keine Regeln gesperrt.',
    lockedHint: 'Gesperrte Regeln werden durch späteres Lernen nicht überschrieben.',
    rebuild: 'Content DNA neu aufbauen',
    rebuilding: 'Wird neu aufgebaut…',
    addSample: 'Sample hinzufügen',
    sampleKind: 'Das ist ein',
    sampleOrigin: 'Quelle',
    sampleLabel: 'Bezeichnung',
    sampleContent: 'Post-Text',
    sampleUrl: 'Quell-URL',
    publishedPost: 'Post-Item-ID des veröffentlichten Posts',
    add: 'Sample hinzufügen',
    adding: 'Wird hinzugefügt…',
    origins: {
      pasted: 'Text einfügen',
      imported: 'Importierte Quelle',
      published: 'Veröffentlichter Post',
    },
    confidence: {
      low: 'Geringe Konfidenz',
      preliminary: 'Vorläufiges Profil',
      reliable: 'Belastbares Profil',
      precise: 'Detailreiches Profil',
      lowHint: 'Füge mehr Golden Samples hinzu, bevor du dich auf Stilregeln verlässt.',
      preliminaryHint: 'Nur weiche Präferenzen; mehr Golden Samples stabilisieren das Profil.',
      reliableHint: 'Genug Material für verlässliche Hinweise – weiterhin keine Garantie.',
      preciseHint: 'Breite Sample-Basis; Writer behandelt die DNA trotzdem als Hinweis, nicht als Fakt.',
    },
  },
  history: {
    ...en.history,
    title: 'Review-Verlauf',
    subtitle: 'Eine ruhige Auditspur für Freigaben, Änderungen, Ablehnungen und Invalidierungen.',
    emptyTitle: 'Noch kein Writer-Verlauf',
    emptyBody: 'Deine Entscheidungen erscheinen hier, ohne den bestehenden Posts-Verlauf zu verändern.',
    statuses: {
      approved: 'Freigegeben',
      rejected: 'Abgelehnt',
      invalidated: 'Invalidiert',
      expired: 'Abgelaufen',
      pending: 'Offen',
    },
  },
  feedback: {
    policyUpdated: 'Writer-Einstellung aktualisiert.',
    runStarted: 'Shadow-Empfehlung gestartet.',
    approved: 'Freigegeben und sicher an die Planung übergeben.',
    edited: 'Änderungswunsch gespeichert. Die vorherige Review ist jetzt invalidiert.',
    alternateStarted:
      'Andere Richtung angefordert. Die vorherige Review ist jetzt invalidiert.',
    rejected: 'Empfehlung abgelehnt.',
    sampleAdded: 'Sample bewusst hinzugefügt.',
    rebuildStarted: 'Eine neue Content-DNA-Version wird aufgebaut.',
  },
};

const es: WriterCopy = {
  ...en,
  eyebrow: 'Piloto automático con aprobación',
  title: 'Tu próxima publicación, ya pensada de principio a fin.',
  subtitle:
    'Writer convierte señales fiables en una recomendación fundamentada y nativa para cada canal. Nada se publica sin tu aprobación.',
  approvalPromise: 'Cada publicación se detiene aquí para tu decisión final.',
  sections: { today: 'Hoy', dna: 'Content DNA', history: 'Historial' },
  status: {
    active: 'Writer activo',
    paused: 'Writer en pausa',
    approvalRequired: 'Aprobación obligatoria',
    shadow: 'Modo Shadow',
  },
  stats: {
    awaiting: 'Pendiente de aprobación',
    preparing: 'En preparación',
    learned: 'Golden Samples aprendidos',
    exceptions: 'Necesita tu ayuda',
  },
  actions: {
    ...en.actions,
    pause: 'Pausar Writer',
    resume: 'Reanudar Writer',
    runShadow: 'Ejecutar una vez en modo Shadow',
    running: 'Preparando recomendación…',
    approve: 'Aprobar y programar',
    approving: 'Aprobando…',
    edit: 'Editar',
    saveEdit: 'Solicitar revisión actualizada',
    alternate: 'Probar otra dirección',
    reject: 'Rechazar',
    cancel: 'Cancelar',
    retry: 'Reintentar',
  },
  setup: {
    migrationTitle: 'Writer está pausado de forma segura para la configuración',
    migrationBody:
      'El almacenamiento de Writer aún no está instalado. Tus herramientas de Publish siguen disponibles sin cambios.',
    setupTitle: 'Enséñale a Writer cómo suena un buen contenido',
    setupBody:
      'Añade al menos tres Golden Samples para una Content DNA preliminar. Con cinco o más, el perfil es más fiable.',
    unavailableTitle: 'Writer no está disponible temporalmente',
    unavailableBody:
      'No pudimos cargar el piloto de forma segura. Writer sigue pausado y no se ha programado contenido.',
    safeNote: 'No se puede publicar nada desde este estado.',
  },
  today: {
    queueTitle: 'Recomendación de hoy',
    queueReady: 'Lista para tu revisión final',
    emptyTitle: 'Nada pendiente de aprobación',
    emptyBody: 'Ejecuta Writer una vez o vuelve cuando la siguiente recomendación esté lista.',
    pausedBody:
      'Las ejecuciones automáticas están pausadas. Aún puedes crear una recomendación Shadow segura.',
  },
  dna: {
    ...en.dna,
    confidence: {
      low: 'Confianza baja',
      preliminary: 'Perfil preliminar',
      reliable: 'Perfil fiable',
      precise: 'Perfil detallado',
      lowHint: 'Añade más Golden Samples antes de confiar en las pautas de estilo.',
      preliminaryHint: 'Solo preferencias suaves; más muestras estabilizarán el perfil.',
      reliableHint: 'Evidencia suficiente para pautas fiables, pero no es una garantía.',
      preciseHint: 'Cobertura amplia; Writer sigue tratándolo como guía, no como hecho.',
    },
  },
};

export function getWriterCopy(locale: AppLocale): WriterCopy {
  if (locale === 'de') return de;
  if (locale === 'es') return es;
  return en;
}
