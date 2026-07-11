// Template catalog v2 — pure data, no logic, no DB access (Oracle O1).
// GOAL-RUN4 content, extended by GOAL-RUN5: strategy block per template
// (user feedback #6), explicit anlass_keys (T2 curation — every goal keeps
// ≥ 2 real paths, no Scheinentscheidungen), and the 52-slot audit (question,
// help, example, kind). Slot kinds govern AI prefill: 'fact' and 'erfahrung'
// are NEVER given values by the AI (authenticity/UWG guardrail, T4).
// Research evidence: "3) Research/Post-Vorlagen-Recherche-2026-07.md".
// Catalog data is German by design — DACH product content, not UI chrome.
import type { PostTemplate } from '@prolora/shared';

export const TEMPLATE_CATALOG: PostTemplate[] = [
  {
    id: 'value-listicle',
    name: 'Die Muster-Liste',
    description: 'Nummerierter Value-Post: ein Problem, 3–5 Punkte, Wissen komplett verschenkt.',
    intent: 'value',
    post_type: 'value_edu',
    psych_levels: ['rational'],
    structure: ['hook', 'problem_kontext', 'schritte', 'takeaway', 'cta'],
    hook_formulas: [
      'Jeder will [ergebnis]. Fast alle scheitern an [hindernis].',
      'Ich habe [n] [faelle] analysiert. Hier sind die [3] Muster, die [ergebnis] verhindern.',
      '[ergebnis] in [zeitraum] — ohne [erwartete voraussetzung]. So:',
    ],
    cta_mechanic: 'save_cta',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin', 'x'],
    anlass_keys: ['nichts'],
    strategy: {
      ziel: 'Autorität aufbauen: ein Post, den deine Zielgruppe speichert und wieder hervorholt.',
      warum: [
        'Listen sind ohne Anstrengung scanbar — genau so liest dein Feed.',
        'Komplett verschenktes Wissen baut Vertrauen auf, bevor du je etwas verkaufst.',
        'Der nützlichste Punkt sitzt spät im Post — das erzeugt Saves statt flüchtiger Likes.',
      ],
      benchmarks: [
        {
          metrik: 'Speicherquote',
          wert: 'Listen/Frameworks gehören zu den meistgespeicherten Formaten',
          quelle: 'LinkedIn-Creator-Format-Analysen 2024/25',
        },
      ],
      aufwand: 'niedrig',
      frequenz: '1–2× pro Woche',
    },
    slots: [
      {
        key: 'thema',
        question: 'Welches Problem deiner Zielgruppe nimmst du dir vor?',
        help: 'Ein einziges, konkretes Problem — je enger, desto stärker der Post.',
        example: 'Social-Media-Posts dauern ewig und bringen nichts',
        kind: 'angle',
        required: true,
      },
      {
        key: 'kernpunkte',
        question: 'Deine 3–5 Punkte dazu (kommagetrennt)',
        help: 'Stichworte reichen — die KI formuliert daraus die Liste.',
        example: 'Hook zuerst schreiben, eine Idee pro Post, feste Posting-Zeit',
        kind: 'angle',
        required: true,
      },
      {
        key: 'beleg',
        question: 'Woher weißt du das? (deine echte Zahl, Analyse oder Erfahrung)',
        help: 'Ein Beweis macht die Liste glaubwürdig — ohne bleibt es Meinung.',
        example: '50 eigene Posts ausgewertet',
        kind: 'fact',
        required: false,
      },
      {
        key: 'zielgruppe',
        question: 'Für wen schreibst du das?',
        help: 'Wird im Hook angesprochen — „Solo-Founder" zieht besser als „alle".',
        example: 'Solo-Founder ohne Marketing-Team',
        kind: 'angle',
        required: false,
        prefill_from: 'target_audience',
      },
    ],
    prompt_hints:
      'Genau eine Idee pro Absatz. Spezifische Zahlen statt Adjektive. Save-würdig schreiben ' +
      '(wiederverwendbares Framework); der nützlichste Teil sitzt spät im Post. Kein Produkt-Pitch ' +
      'im Hauptteil — höchstens ein P.S. Die erste Zeile trägt den ganzen Post.',
  },
  {
    id: 'value-hormozi-carousel',
    name: 'Hormozi-Karussell',
    description: 'Playbook-Karussell: Claim → Proof → Schritt-Slides. Wissen komplett verschenken.',
    intent: 'value',
    post_type: 'value_edu',
    psych_levels: ['rational', 'social'],
    structure: ['claim_slide', 'proof_slide', 'schritt_slides', 'merksatz_cta_slide', 'caption'],
    hook_formulas: [
      'Ich habe [n] [faelle] analysiert. Hier sind die [3] Dinge, die sie killen.',
      'Wie du [yay] bekommst, ohne [boo] — selbst wenn [fear].',
    ],
    cta_mechanic: 'comment_trigger',
    style_preset: 'hormozi_carousel',
    format: 'carousel_pdf',
    recommended_platforms: ['linkedin'],
    anlass_keys: ['nichts'],
    strategy: {
      ziel: 'Maximale Reichweite für dein Wissen: das Playbook-Format, das LinkedIn belohnt.',
      warum: [
        'Dokument-Posts halten Leser mehrere Sekunden pro Slide — der Algorithmus liest das als Qualität.',
        '„Proof schlägt Promise": Slide 2 liefert den Beweis, bevor irgendjemand etwas glauben muss.',
        'Der Asset-CTA am Ende verwandelt Reichweite in Kommentare und Gespräche.',
      ],
      benchmarks: [
        {
          metrik: 'Reichweite vs. Text-Post',
          wert: '≈ 1,6–1,9× für Dokument-/Karussell-Posts',
          quelle: 'LinkedIn-Format-Studien 2024/25',
        },
      ],
      aufwand: 'hoch',
      frequenz: '1× pro Woche',
      voraussetzungen: ['Design-Tool für PDF-Slides (Canva/Figma/Keynote)'],
    },
    slots: [
      {
        key: 'thema',
        question: 'Deine eine These für dieses Karussell?',
        help: 'Ein Thema, eine steile These — Slide 1 muss in max. 8 Worte passen.',
        example: 'Die meisten Posts scheitern in der ersten Zeile',
        kind: 'angle',
        required: true,
      },
      {
        key: 'kernpunkte',
        question: 'Deine 3–5 Kernpunkte (kommagetrennt)',
        help: 'Je Punkt eine Slide: Regel + ein Satz Begründung.',
        example: 'Hook vor Inhalt, Zahlen statt Adjektive, ein CTA pro Post',
        kind: 'angle',
        required: true,
      },
      {
        key: 'beleg',
        question: 'Dein Beweis für Slide 2? (echte Zahl, Analyse, Referenz)',
        help: '„Proof schlägt Promise" — ohne Beweis-Slide fällt das Format zusammen.',
        example: '200 LinkedIn-Posts von 10 Creators ausgewertet',
        kind: 'fact',
        // Kein prefill_from: eine Produktbeschreibung ist kein Beweis (T4/UWG) —
        // der Beweis-Slot bleibt immer eine echte Nutzer-Angabe.
        required: true,
      },
      {
        key: 'asset',
        question: 'Welches Asset gibst du gegen einen Kommentar heraus?',
        help: 'Muss wirklich existieren — nur versprechen, was du liefern kannst.',
        example: 'Notion-Vorlage „Post-Playbook"',
        kind: 'fact',
        required: false,
      },
    ],
    prompt_hints:
      'Playbook-Stil: Slide 1 = Bold Claim (max. 8 Worte), Slide 2 = Proof (Zahl/Referenz — ' +
      '"Proof schlägt Promise"), dann je Slide genau ein Schritt (Regel + 1 Satz Begründung), ' +
      'letzte Slide = zitierfähiger Merksatz + CTA. Maximal 10 Slides (Completion-Rate). ' +
      'Kurze Sätze, keine Adjektiv-Füller, jede Aussage mit Zahl oder Beispiel. ' +
      'Caption separat: 2–3 Sätze Kontext + CTA.',
    manual_steps: [
      'Slides als PDF exportieren (Canva/Figma/Keynote, quadratisch, High-Contrast-Typografie, max. 10 Slides).',
      'PDF auf LinkedIn nativ als Dokument hochladen — Prolora publisht aktuell Text + Bilder (Doc-Upload: Phase T6).',
      'Caption aus Prolora als Post-Text verwenden.',
    ],
  },
  {
    id: 'tutorial-asset-funnel',
    name: 'How-To mit Asset-Funnel',
    description: 'Schritt-für-Schritt-Anleitung, die dein Asset gegen einen Kommentar hergibt.',
    intent: 'value',
    post_type: 'tutorial',
    psych_levels: ['rational'],
    structure: ['hook_endergebnis', 'voraussetzungen', 'schritte', 'ergebnis', 'cta'],
    hook_formulas: [
      'So baust du [ergebnis] in [zeit] — Schritt für Schritt.',
      'Das hätte mir [zeit] gespart. Die Anleitung, die ich gern gehabt hätte:',
    ],
    cta_mechanic: 'comment_trigger',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin', 'x'],
    anlass_keys: ['feature'],
    strategy: {
      ziel: 'Wissen in Gespräche verwandeln: die Anleitung überzeugt, das Asset holt die Kommentare.',
      warum: [
        'Eine nachmachbare Anleitung beweist Kompetenz besser als jede Behauptung.',
        'Das Trigger-Wort senkt die Hürde auf einen einzigen Kommentar — kein Link, kein Formular.',
        'Jeder Kommentar startet ein 1:1-Gespräch mit einem vorqualifizierten Lead.',
      ],
      benchmarks: [
        {
          metrik: 'Kommentare vs. Link-Post',
          wert: '≈ 2–5× durch Comment-Trigger',
          quelle: 'Comment-to-DM-Funnel-Fallstudien 2025',
        },
      ],
      aufwand: 'mittel',
      frequenz: '1× pro Woche',
      voraussetzungen: ['Das versprochene Asset existiert', 'DMs manuell beantworten (keine Automation)'],
    },
    slots: [
      {
        key: 'ergebnis',
        question: 'Was kann der Leser am Ende der Anleitung?',
        help: 'Das konkrete Endergebnis — es steht im Hook UND am Schluss.',
        example: 'Posts automatisch auf 5 Plattformen veröffentlichen',
        kind: 'angle',
        required: true,
      },
      {
        key: 'schritte',
        question: 'Die Schritte in Stichworten (3–7, kommagetrennt)',
        help: 'Grob reicht — die KI macht daraus nummerierte, nachmachbare Schritte.',
        example: 'Account verbinden, Vorlage wählen, Zeitplan setzen',
        kind: 'angle',
        required: true,
      },
      {
        key: 'asset',
        question: 'Welches Asset gibst du gegen einen Kommentar heraus?',
        help: 'Vorlage, Checkliste, JSON — es muss fertig sein, bevor der Post live geht.',
        example: 'n8n-Workflow als JSON-Export',
        kind: 'fact',
        required: true,
      },
      {
        key: 'zielgruppe',
        question: 'Für wen ist die Anleitung?',
        help: 'Bestimmt Ton und Vorwissen — „ohne Code-Kenntnisse" senkt die Hürde.',
        example: 'Solo-Founder ohne Dev-Hintergrund',
        kind: 'angle',
        required: false,
        prefill_from: 'target_audience',
      },
    ],
    prompt_hints:
      'Jeder Schritt maximal ein Satz plus optional ein konkreter Wert (Aktion + kurzes Warum/Stolperfalle). ' +
      'Das Endergebnis steht im Hook UND am Schluss. Ein "ohne [teures Tool/Vorwissen]"-Versprechen senkt die Hürde. ' +
      'CTA: Trigger-Wort in GROSSBUCHSTABEN, ehrlich begründen, warum das Asset per DM kommt.',
    manual_steps: [
      'Kommentare mit dem Trigger-Wort manuell per DM beantworten — Prolora automatisiert keine DMs.',
    ],
  },
  {
    id: 'tutorial-plain',
    name: 'Schritt-für-Schritt pur',
    description: 'Sachliches Tutorial ohne Funnel — funktioniert auch auf Mastodon und Telegram.',
    intent: 'value',
    post_type: 'tutorial',
    psych_levels: ['rational'],
    structure: ['hook_endergebnis', 'voraussetzungen', 'schritte', 'ergebnis', 'cta'],
    hook_formulas: [
      '[ergebnis] in [zeit]. Schritt für Schritt:',
      'Du brauchst kein [teures tool] für [ergebnis]. So geht es mit [alternative]:',
      'Ich habe [aufgabe] von [n stunden] auf [n minuten] verkürzt. Die exakte Anleitung:',
    ],
    cta_mechanic: 'save_cta',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin', 'mastodon', 'telegram', 'bluesky'],
    anlass_keys: ['feature'],
    strategy: {
      ziel: 'Reines Weiterhelfen ohne Gegenleistung — der Post, der dich überall willkommen macht.',
      warum: [
        'Wer teilt, wirkt selbst kompetent — Tutorials werden deshalb überdurchschnittlich geteilt.',
        'Ohne Funnel-Mechanik funktioniert das Format auch in marketing-skeptischen Räumen (Mastodon!).',
        'Sachlicher Ton + nachmachbare Schritte = der sicherste Autoritäts-Baustein überhaupt.',
      ],
      benchmarks: [
        {
          metrik: 'Teil-/Speicherquote',
          wert: 'How-Tos werden überdurchschnittlich geteilt und gespeichert',
          quelle: 'Plattform-Format-Analysen 2025',
        },
      ],
      aufwand: 'niedrig',
      frequenz: '1–2× pro Woche',
    },
    slots: [
      {
        key: 'ergebnis',
        question: 'Was kann der Leser am Ende?',
        help: 'Das konkrete Ergebnis — Hook und Schlusssatz in einem.',
        example: 'Eigenen Mastodon-Server in 10 Minuten aufsetzen',
        kind: 'angle',
        required: true,
      },
      {
        key: 'schritte',
        question: 'Die Schritte in Stichworten (3–7, kommagetrennt)',
        help: 'Grob reicht — die KI ergänzt pro Schritt ein Warum oder eine Stolperfalle.',
        example: 'Server mieten, Docker-Compose kopieren, Domain verbinden',
        kind: 'angle',
        required: true,
      },
      {
        key: 'zeit',
        question: 'Wie lange dauert es wirklich?',
        help: 'Deine ehrliche Zeitangabe — sie macht den Hook konkret.',
        example: '10 Minuten',
        kind: 'fact',
        required: false,
      },
      {
        key: 'voraussetzungen',
        question: 'Was braucht man vorher?',
        help: 'Ehrliche Einstiegshürden nennen — das filtert Frust-Kommentare weg.',
        example: 'Eine eigene Domain, 5 €/Monat Server',
        kind: 'angle',
        required: false,
      },
    ],
    prompt_hints:
      'Nummerierte, nachmachbare Schritte; pro Schritt Aktion + kurzes Warum oder Stolperfalle. ' +
      'Am Ende das Ergebnis wiederholen. Teilbarkeit einbauen: der Post soll den Teilenden ' +
      'kompetent und hilfreich aussehen lassen. Sachlicher Ton, kein Marketing.',
  },
  {
    id: 'product-time-saved',
    name: 'Ergebnis-Demo',
    description: 'Produkt-Demo über das Ergebnis: "spart mir 2 Stunden" statt Feature-Liste.',
    intent: 'product',
    post_type: 'product_demo',
    psych_levels: ['rational', 'social'],
    structure: ['hook', 'status_quo_schmerz', 'demonstration', 'ergebnis_zahl', 'cta'],
    hook_formulas: [
      'So habe ich [nerviges problem] in unter [zeit] gelöst.',
      'Dieses [setup/feature] nimmt mir [x stunden] pro Woche ab.',
      'Ich habe [prozess] komplett automatisiert. Hier ist der Ablauf:',
    ],
    cta_mechanic: 'link_in_comment',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin', 'x'],
    anlass_keys: ['zahl'],
    strategy: {
      ziel: 'Produkt zeigen, ohne zu werben: das messbare Ergebnis überzeugt, das Produkt ist Werkzeug.',
      warum: [
        'Eine echte Ersparnis-Zahl im Hook schlägt jede Feature-Liste — Ergebnis vor Funktion.',
        'PAS-Struktur (Problem → Schmerz → Lösung) holt Leser bei ihrem eigenen Frust ab.',
        'Founder-Ton statt Pressemitteilung umgeht die Werbe-Abwehr des Feeds.',
      ],
      benchmarks: [
        {
          metrik: 'Qualifizierte Nachfragen',
          wert: 'Ergebnis-Demos erzeugen „Wie hast du das gebaut?"-Kommentare statt leerer Likes',
          quelle: 'Founder-/Build-in-public-Fallstudien 2025 (qualitativ)',
        },
      ],
      aufwand: 'niedrig',
      frequenz: 'max. 1× pro Woche (80/20-Regel: Value vor Produkt)',
    },
    slots: [
      {
        key: 'problem',
        question: 'Welches nervige Problem löst du damit?',
        help: 'Aus Sicht des Betroffenen formuliert — der Schmerz trägt den Einstieg.',
        example: 'Jeden Post fünfmal für fünf Plattformen umschreiben',
        kind: 'angle',
        required: true,
      },
      {
        key: 'ersparnis',
        question: 'Deine echte Ersparnis als Zahl (Zeit oder Geld)',
        help: 'Nur echte Zahlen — erfundene Ersparnisse fliegen auf und sind wettbewerbsrechtlich heikel.',
        example: '4 Stunden pro Woche',
        kind: 'fact',
        required: true,
      },
      {
        key: 'produkt',
        question: 'Womit? (dein Produkt/Setup in einem Satz)',
        help: 'Wird beiläufig erwähnt — das Ergebnis bleibt der Held des Posts.',
        example: 'Prolora — einmal schreiben, überall veröffentlichen',
        kind: 'angle',
        required: false,
        prefill_from: 'product_description',
      },
      {
        key: 'link',
        question: 'Link zum Produkt (optional)',
        help: 'Auf LinkedIn wandert er automatisch in den ersten Kommentar (Reichweite!).',
        example: 'https://prolora.eu',
        kind: 'fact',
        required: false,
      },
    ],
    prompt_hints:
      'Genau ein Use-Case. PAS als Gerüst: Problem → Schmerz verstärken (konkrete Kosten des Status quo) → ' +
      'Lösung. Ergebnis vor Feature; das Produkt ist Werkzeug, nie Held. Founder-Ton statt ' +
      'Pressemitteilung. Spezifischer Ask statt "Schaut mal rein". Beweis erwähnen (Screenshot/Screencast).',
  },
  {
    id: 'product-automation-loop',
    name: 'Automation-Loop',
    description: 'AI-Automation-Creator-Stil: Screencast-Loop + Value-Caption + Template als Lead-Magnet.',
    intent: 'product',
    post_type: 'product_demo',
    psych_levels: ['rational', 'social'],
    structure: ['overlay', 'hook', 'workflow_schritte', 'stack', 'einschraenkung', 'cta'],
    hook_formulas: [
      'Ich habe eine Automation gebaut, die [manuelle aufgabe] komplett übernimmt — [n stunden/euro pro woche] gespart.',
      'Dieser [n8n/make]-Workflow erledigt [aufgabe] in [n] Minuten. Vorlage gibt es kostenlos.',
    ],
    cta_mechanic: 'comment_trigger',
    style_preset: 'ai_automation_screencast',
    format: 'image_text',
    recommended_platforms: ['linkedin', 'x'],
    anlass_keys: ['feature'],
    strategy: {
      ziel: 'Einen fertigen Workflow in Leads verwandeln: sehen → wollen → Template gegen Kommentar.',
      warum: [
        'Der Screencast-Loop beweist in 5 Sekunden, dass es wirklich funktioniert — kein Behaupten nötig.',
        'Das verschenkte Template macht aus Zuschauern Kommentare und aus Kommentaren Gespräche.',
        'Die ehrliche Einschränkung („funktioniert nicht für …") macht den Rest erst glaubwürdig.',
      ],
      benchmarks: [
        {
          metrik: 'Kommentare (Template-CTA)',
          wert: '≈ 2–5× vs. Link-Post durch Comment-Trigger',
          quelle: 'AI-Automation-Creator-Fallstudien 2025',
        },
      ],
      aufwand: 'hoch',
      frequenz: '1× pro Woche',
      voraussetzungen: [
        '5–7-Sekunden-Screencast-Loop des Workflows',
        'Template/Asset zum Verschenken',
        'DMs manuell beantworten (keine Automation)',
      ],
    },
    slots: [
      {
        key: 'aufgabe',
        question: 'Welche manuelle Aufgabe übernimmt die Automation?',
        help: 'Die Aufgabe, die vorher genervt hat — sie trägt den Hook.',
        example: 'Kundenanfragen sortieren und beantworten',
        kind: 'angle',
        required: true,
      },
      {
        key: 'ersparnis',
        question: 'Deine echte Ersparnis als Zahl (Stunden oder Euro pro Woche)',
        help: 'Nur echte Zahlen — der Hook lebt davon, dass es stimmt.',
        example: '6 Stunden pro Woche',
        kind: 'fact',
        required: true,
      },
      {
        key: 'asset',
        question: 'Welches Template/Asset gibst du heraus?',
        help: 'Muss existieren und funktionieren — es ist dein Versprechen.',
        example: 'Der n8n-Workflow als JSON',
        kind: 'fact',
        required: true,
      },
      {
        key: 'stack',
        question: 'Womit gebaut? (Tools/APIs)',
        help: 'Der Stack macht es nachbaubar und beantwortet die häufigste Frage vorweg.',
        example: 'n8n + Claude API + Google Sheets',
        kind: 'fact',
        required: false,
      },
    ],
    prompt_hints:
      'Caption-Struktur: Ergebnis-Hook mit Zeit-/Geld-Zahl → was der Workflow tut (3–5 Bullets: ' +
      'Trigger → Verarbeitung → Output) → Stack → eine ehrliche Einschränkung (Glaubwürdigkeit) → ' +
      'Template-CTA. slides[0] = statischer Overlay-Satz über dem Video-Loop. ' +
      'Nur versprechen, was lieferbar ist — das Asset muss existieren.',
    manual_steps: [
      'Screencast des Workflows als 5–7-Sekunden-Loop aufnehmen/exportieren.',
      'Overlay-Satz (slides[0]) im Schnitt-Tool über das Video legen.',
      'Kommentare mit dem Trigger-Wort manuell per DM beantworten — Prolora automatisiert keine DMs.',
    ],
  },
  {
    id: 'review-honest',
    name: '30-Tage-Fazit',
    description: 'Ehrlicher Erfahrungsbericht mit Stärken UND Schwächen — der Glaubwürdigkeits-Klassiker.',
    intent: 'social_proof',
    post_type: 'review',
    psych_levels: ['rational', 'social'],
    structure: ['hook', 'kontext_warum', 'staerken', 'schwaechen', 'fazit_fuer_wen', 'cta'],
    hook_formulas: [
      'Ich habe [produkt] [30] Tage getestet — hier ist mein ehrliches Fazit.',
      '[produkt] kostet [preis]. Lohnt sich das? Mein Ergebnis nach [zeitraum]:',
      'Alle hypen [produkt]. Ich habe es ausprobiert — mein Fazit ist differenzierter.',
    ],
    cta_mechanic: 'none',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin', 'mastodon', 'x'],
    anlass_keys: ['meinung'],
    strategy: {
      ziel: 'Glaubwürdigkeit aufbauen: deine ehrliche Erfahrung wird zum Beweis, dass man dir trauen kann.',
      warum: [
        'Zweiseitige Bewertungen (Stärken UND Schwächen) wirken messbar glaubwürdiger als reines Lob.',
        'Das „geeignet für / nicht geeignet für"-Fazit liefert echte Entscheidungshilfe — das wird geteilt.',
        'Die offene Erfahrungsfrage am Ende zieht die besten Kommentare eines ganzen Monats.',
      ],
      benchmarks: [
        {
          metrik: 'Vertrauens-Signal',
          wert: 'Two-sided Reviews schlagen reine Lobeshymnen bei Glaubwürdigkeit deutlich',
          quelle: 'Persuasions-Forschung zu zweiseitigen Argumenten',
        },
      ],
      aufwand: 'mittel',
      frequenz: 'bei echter Test-Erfahrung',
      voraussetzungen: ['Echte Nutzung über den Testzeitraum'],
    },
    slots: [
      {
        key: 'produkt',
        question: 'Was hast du getestet?',
        help: 'Produkt- oder Tool-Name — er gehört in den Hook.',
        example: 'Notion AI',
        kind: 'fact',
        required: true,
      },
      {
        key: 'testzeitraum',
        question: 'Wie lange hast du es wirklich genutzt?',
        help: 'Der Zeitraum macht das Fazit belastbar — „30 Tage" schlägt „kurz angetestet".',
        example: '30 Tage',
        kind: 'fact',
        required: true,
      },
      {
        key: 'staerken',
        question: 'Deine 2–3 echten Stärken (kommagetrennt)',
        help: 'Konkret mit Situation — was hat dich wirklich überzeugt?',
        example: 'Meeting-Notizen in Sekunden, versteht deutschen Kontext',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'schwaechen',
        question: 'Mindestens ein ehrlicher Minuspunkt',
        help: 'Die Schwäche macht das Lob glaubwürdig — was hat dich genervt?',
        example: 'Preis pro Sitz wird ab 3 Leuten happig',
        kind: 'erfahrung',
        required: true,
      },
    ],
    prompt_hints:
      'Two-sided schreiben: Stärken UND Schwächen konkret, je mit Beispiel. Erwartung vs. Realität. ' +
      'Klares "geeignet für / nicht geeignet für" am Ende. Keine Affiliate-Sprache. ' +
      'Falls der Nutzer eine Kooperation erwähnt: Kennzeichnung (#Anzeige) an den ANFANG des Posts. ' +
      'CTA: offene Erfahrungsfrage an andere Nutzer.',
  },
  {
    id: 'unboxing-first-look',
    name: 'Ersteindruck',
    description: 'Unboxing als Text: Erwartung → Reveal → 3 Eindrücke → Langzeittest-Ankündigung.',
    intent: 'personal_brand',
    post_type: 'unboxing',
    psych_levels: ['emotional'],
    structure: ['hook', 'was_und_warum', 'drei_ersteindruecke', 'offene_frage', 'cta'],
    hook_formulas: [
      'Endlich da: [produkt]. Erster Eindruck nach 10 Minuten:',
      'Ich habe mir [produkt] gegönnt. War das ein Fehler?',
      'Tag 1 mit [tool]: Onboarding, erster Aha-Moment, erste Ernüchterung.',
    ],
    cta_mechanic: 'poll',
    style_preset: 'doku_modus',
    format: 'image_text',
    recommended_platforms: ['x', 'bluesky', 'linkedin'],
    anlass_keys: ['neu'],
    strategy: {
      ziel: 'Den Neuheits-Moment nutzen: Miterleben erzeugen und eine Serie (Langzeittest) starten.',
      warum: [
        'Der „Geschenk-Moment" (Erwartung → Reveal) ist emotional ansteckend — Leser erleben mit.',
        'Ein irritierender Ersteindruck neben zwei positiven macht dich zum ehrlichen Beobachter.',
        'Die Langzeittest-Ankündigung ist ein Open Loop — ein konkreter Grund, dir zu folgen.',
      ],
      benchmarks: [
        {
          metrik: 'Engagement-Zeitfenster',
          wert: 'Ersteindrücke performen im Neuheits-Fenster (≈ 48 h) am stärksten',
          quelle: 'Unboxing-/First-Look-Format-Analysen 2025',
        },
      ],
      aufwand: 'niedrig',
      frequenz: 'bei echtem Anlass',
      voraussetzungen: ['Foto des Produkts/Setups'],
    },
    slots: [
      {
        key: 'produkt',
        question: 'Was ist angekommen?',
        help: 'Das neue Ding — Name reicht, das Foto erzählt den Rest.',
        example: 'Das reMarkable Paper Pro',
        kind: 'fact',
        required: true,
      },
      {
        key: 'warum',
        question: 'Warum hast du es dir geholt? (Erwartung, Hype, Problem)',
        help: 'Deine Motivation macht den Reveal spannend — worauf hast du gehofft?',
        example: 'Alle schwärmen davon — ich will endlich papierlos arbeiten',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'eindruecke',
        question: 'Deine 3 ersten Eindrücke (kommagetrennt, gern einer davon irritierend)',
        help: 'Sensorisch und konkret — was ist dir in den ersten 10 Minuten aufgefallen?',
        example: 'Display fühlt sich wie Papier an, Setup in 2 Minuten, der Stift quietscht leise',
        kind: 'erfahrung',
        required: true,
      },
    ],
    prompt_hints:
      'Dramaturgie Erwartung → Reveal: der "Geschenk-Moment" trägt den Post, nicht das Endurteil. ' +
      'Sensorische/konkrete Details (stellvertretendes Miterleben). Genau 3 Ersteindrücke, ' +
      'positiv UND irritierend. Offene Erwartung formulieren, Langzeittest ankündigen (Serie). ' +
      'CTA als Frage: "Soll ich den Langzeit-Test posten?" oder "Was soll ich zuerst testen?"',
    manual_steps: ['Foto des Produkts/Setups anhängen — der Post lebt vom Bild.'],
  },
  {
    id: 'transformation-numbers',
    name: 'Vorher/Nachher mit Zahlen',
    description: 'Transformation nach BAB-Logik: Delta im Hook, der eine Hebel, Beweis in der Brücke.',
    intent: 'social_proof',
    post_type: 'transformation',
    psych_levels: ['rational', 'emotional'],
    structure: ['hook_kontrast', 'ausgangslage', 'wendepunkt_hebel', 'ergebnis_beweis', 'learnings', 'cta'],
    hook_formulas: [
      'Vor [zeitraum]: [vorher-zahl]. Heute: [nachher-zahl]. Das hat den Unterschied gemacht:',
      'Von [vorher] auf [nachher] in [zeitraum] — ohne [erwartetes].',
      '[kennzahl] +[n] % in [zeitraum]. Der komplette Weg, inklusive der Fehler:',
    ],
    cta_mechanic: 'comment_trigger',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin', 'x'],
    anlass_keys: ['zahl'],
    strategy: {
      ziel: 'Beweisen statt behaupten: dein echtes Vorher/Nachher wird zum stärksten Verkaufsargument.',
      warum: [
        'Der Zahlen-Kontrast im Hook stoppt den Daumen — Deltas sind unwiderstehlich konkret.',
        'Der EINE Hebel (statt zehn Tipps) macht die Geschichte glaubwürdig und nachmachbar.',
        'Demut („der Weg war holprig") schlägt Prahlerei — Überidealisierung zerstört alles.',
      ],
      benchmarks: [
        {
          metrik: 'Engagement',
          wert: 'Vorher/Nachher mit Delta im Hook gehört zu den stärksten Engagement-Formaten',
          quelle: 'BAB-/Copywriting-Fallstudien 2025',
        },
      ],
      aufwand: 'mittel',
      frequenz: 'bei echtem Meilenstein',
      voraussetzungen: ['Echte Vorher-/Nachher-Zahlen', 'Beweis-Screenshot'],
    },
    slots: [
      {
        key: 'vorher',
        question: 'Dein Vorher-Zustand als echte Zahl',
        help: 'Die Ausgangslage — je schmerzhafter konkret, desto stärker der Kontrast.',
        example: '6 Std/Woche für Social Media, 200 Follower',
        kind: 'fact',
        required: true,
      },
      {
        key: 'nachher',
        question: 'Dein Nachher-Zustand als echte Zahl',
        help: 'Nicht überidealisieren — die ehrliche Zahl ist die glaubwürdige.',
        example: '40 Min/Woche, 1.800 Follower',
        kind: 'fact',
        required: true,
      },
      {
        key: 'zeitraum',
        question: 'In welchem Zeitraum ist das passiert?',
        help: 'Der ehrliche Zeitrahmen — „6 Monate" schlägt ein unglaubwürdiges „2 Wochen".',
        example: '6 Monate',
        kind: 'fact',
        required: true,
      },
      {
        key: 'hebel',
        question: 'Was war der EINE Hebel, der es ausgemacht hat?',
        help: 'Deine echte Erkenntnis — die Brücke zwischen Vorher und Nachher.',
        example: 'Feste Posting-Routine statt Inspiration abwarten',
        kind: 'erfahrung',
        required: true,
      },
    ],
    prompt_hints:
      'BAB-Logik: Before konkret schmerzhaft, After attraktiv aber NICHT überidealisiert ' +
      '(zerstört Glaubwürdigkeit), der Beweis sitzt in der Brücke — dort, wo die Methode erklärt wird. ' +
      'Demut statt Prahlerei: der Weg war holprig. CTA: Trigger-Wort für den detaillierten Ablauf.',
    manual_steps: [
      'Beweis-Visual anhängen (Screenshot/Grafik der Zahlen).',
      'Kommentare mit dem Trigger-Wort manuell per DM beantworten — Prolora automatisiert keine DMs.',
    ],
  },
  {
    id: 'bip-fail-learning',
    name: 'Fehler des Tages',
    description: 'Build-in-public: ein Fail, seine Ursache, das Learning. Ungefiltert, ohne CTA.',
    intent: 'personal_brand',
    post_type: 'build_in_public',
    psych_levels: ['emotional', 'social'],
    structure: ['hook', 'was_passiert_ist', 'ursache', 'fix_learning', 'offene_frage'],
    hook_formulas: [
      'Ehrliche Phase: Gestern ist mir [x] um die Ohren geflogen.',
      'Ich baue [projekt] öffentlich. Heute: mein teuerster Fehler bisher.',
      'Diesen Teil von [projekt/business] zeigt niemand. Hier ist meiner:',
    ],
    cta_mechanic: 'none',
    style_preset: 'doku_modus',
    format: 'text',
    recommended_platforms: ['x', 'mastodon', 'bluesky'],
    anlass_keys: ['wip'],
    strategy: {
      ziel: 'Nahbarkeit aufbauen: dein ehrlicher Fail erzeugt die Verbindung, die kein Erfolgs-Post schafft.',
      warum: [
        'Verletzlichkeit löst Reziprozität aus — Leser teilen ihre eigenen Fails zurück.',
        'Das Learning ist der Wert des Posts — du gibst etwas, statt nur zu beichten.',
        'Kein CTA nötig: Ungefiltertes wirkt, gerade WEIL es nichts will.',
      ],
      benchmarks: [
        {
          metrik: 'Kommentar-Tiefe',
          wert: 'Fail-Posts erzeugen die persönlichsten Kommentare (Reziprozitäts-Effekt)',
          quelle: 'Build-in-public-Fallstudien 2025',
        },
      ],
      aufwand: 'niedrig',
      frequenz: 'wenn es passiert — Echtheit schlägt Redaktionsplan',
    },
    slots: [
      {
        key: 'was_passiert',
        question: 'Was ist schiefgegangen? (ungefiltert)',
        help: 'Der Fail, wie du ihn einem Freund erzählen würdest — sprich ihn einfach ein.',
        example: 'Migration ohne Backup gefahren — 2 Stunden Daten weg',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'ursache',
        question: 'Woran lag es wirklich?',
        help: 'Die ehrliche Ursache — meist unbequemer als die technische.',
        example: 'Ich wollte vor dem Termin noch schnell fertig werden',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'learning',
        question: 'Dein Learning oder Fix daraus?',
        help: 'Der Wert für die Leser — was machst du ab jetzt anders?',
        example: 'Backup-Check ist jetzt Teil des Deploy-Skripts',
        kind: 'erfahrung',
        required: true,
      },
    ],
    prompt_hints:
      'Dokumentations-Ton, kein Marketing-Satzbau. Das Learning ist der Wert, nicht der Erfolg. ' +
      'Konkrete Zahlen und Details ungeschönt. Kein harter CTA — höchstens eine offene Frage. ' +
      'Kurz halten: 3–6 Sätze plus Screenshot-Verweis.',
    manual_steps: ['Screenshot als Beweis anhängen (Terminal, Fehlermeldung, Dashboard).'],
  },
  {
    id: 'bip-daily-doc',
    name: 'Doku-Modus',
    description: 'Der kleine tägliche Build-in-public-Post: heute gebaut, ein Detail, Serien-Nummer.',
    intent: 'personal_brand',
    post_type: 'build_in_public',
    psych_levels: ['emotional', 'social'],
    structure: ['hook', 'was_gebaut', 'detail', 'naechster_schritt'],
    hook_formulas: [
      'Tag [n] von [projekt]: [unerwartetes ergebnis].',
      'Woche [n] mit [projekt]: die ehrlichen Zahlen.',
      'Heute gebaut: [feature]. Das eine Detail, das mich überrascht hat:',
    ],
    cta_mechanic: 'none',
    style_preset: 'doku_modus',
    format: 'image_text',
    recommended_platforms: ['x', 'bluesky', 'mastodon'],
    anlass_keys: ['wip'],
    strategy: {
      ziel: 'Einen Follow-Grund schaffen: die nummerierte Serie macht aus Zuschauern Stammleser.',
      warum: [
        'Serien („Tag 12 von …") erzeugen Fortsetzungs-Spannung — man will wissen, wie es weitergeht.',
        'Kleine echte Zahlen (auch peinliche) sind die Währung von Build-in-public.',
        'Der offene nächste Schritt am Ende ist ein Open Loop — Grund, morgen wiederzukommen.',
      ],
      benchmarks: [
        {
          metrik: 'Follower-Wachstum',
          wert: 'Konstante Serien schlagen sporadische Einzel-Posts beim Wachstum deutlich',
          quelle: 'Build-in-public-Fallstudien 2025',
        },
      ],
      aufwand: 'niedrig',
      frequenz: '3–5× pro Woche (Serie)',
    },
    slots: [
      {
        key: 'gebaut',
        question: 'Was hast du heute gebaut oder gelernt?',
        help: 'Der Tages-Fortschritt in einem Satz — klein ist völlig okay.',
        example: 'Den Template-Wizard fertig gebaut',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'detail',
        question: 'Das eine Detail, das dich heute überrascht hat?',
        help: 'Die Beobachtung, die nur du machen konntest — sie macht den Post einzigartig.',
        example: 'Die Hälfte der Nutzer klickt zuerst auf den teuersten Plan',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'serie',
        question: 'Deine Serien-Nummer?',
        help: 'Die laufende Nummer deiner Serie — sie erzeugt den Follow-Grund.',
        example: 'Woche 12',
        kind: 'fact',
        required: false,
      },
    ],
    prompt_hints:
      'Klein und konkret: 3–5 Sätze. Fünf Transparenz-Ebenen als Repertoire (Fortschritt, Metriken, ' +
      'Fails, Learnings, Entscheidungsgründe) — hier zählt die eine heutige Beobachtung. ' +
      'Konkrete Zahlen als Anker, auch kleine. Nummerierte Serie erzeugt einen Follow-Grund. ' +
      'Offener nächster Schritt am Ende (Open Loop), kein CTA.',
    manual_steps: ['Screenshot des Tages anhängen (Work in progress, ungefiltert).'],
  },
  {
    id: 'lifestyle-stack',
    name: 'Mein Setup/Stack',
    description: 'Alltags-Post mit subtiler Produkt-Einbettung — die Story trägt, das Produkt ist Requisite.',
    intent: 'personal_brand',
    post_type: 'lifestyle',
    psych_levels: ['emotional'],
    structure: ['hook', 'alltags_story', 'beilaeufige_einbettung', 'pointe', 'weiche_frage'],
    hook_formulas: [
      'Mein [morgen/setup/stack] als [rolle] — inklusive [ehrliches detail].',
      '[n] Tools, ohne die mein Arbeitstag kippt.',
      'Niemand fragt danach, aber hier ist mein komplettes [setup] trotzdem:',
    ],
    cta_mechanic: 'none',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin', 'x'],
    anlass_keys: ['nichts'],
    strategy: {
      ziel: 'Nahbar bleiben und dein Produkt beiläufig platzieren — ohne dass es nach Werbung riecht.',
      warum: [
        'Setup-Posts bedienen echte Neugier — „womit arbeiten andere?" wird immer geklickt.',
        'Die beiläufige Erwähnung (nie im Hook, nie mit Features) umgeht die Werbe-Abwehr komplett.',
        'Die weiche Frage am Ende („Was ist in eurem Stack?") lädt zum leichtesten Kommentar ein.',
      ],
      benchmarks: [
        {
          metrik: 'Produkt-Erwähnung ohne Reaktanz',
          wert: 'Beiläufige Einbettung umgeht Werbe-Abwehr — Wirkung indirekt, nicht messbar in Klicks',
          quelle: 'Product-Placement-Forschung (qualitativ)',
        },
      ],
      aufwand: 'niedrig',
      frequenz: 'max. 1× pro Monat pro Produkt',
    },
    slots: [
      {
        key: 'rolle',
        question: 'Deine Rolle, aus der du erzählst?',
        help: 'Der Blickwinkel des Posts — Leser vergleichen sich mit dieser Rolle.',
        example: 'Solo-Founder',
        kind: 'fact',
        required: true,
      },
      {
        key: 'tools',
        question: '3–5 Tools oder Dinge deines echten Alltags (kommagetrennt)',
        help: 'Dein wirklicher Stack — erfundene Setups fliegen in den Kommentaren auf.',
        example: 'Notion, Raycast, Prolora, ein Timer aus Holz',
        kind: 'fact',
        required: true,
      },
      {
        key: 'detail',
        question: 'Ein ehrliches Alltagsdetail dazu?',
        help: 'Die kleine Unperfektheit macht den Post menschlich.',
        example: 'Der zweite Kaffee entscheidet, ob es ein guter Tag wird',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'produkt',
        question: 'Dein eigenes Produkt (wird nur beiläufig erwähnt)',
        help: 'Taucht als EIN Tool unter mehreren auf — nie als Held der Geschichte.',
        example: 'Prolora',
        kind: 'angle',
        required: false,
        prefill_from: 'product_description',
      },
    ],
    prompt_hints:
      'Die Story trägt, das Produkt ist Requisite: maximal EINE beiläufige Erwähnung, nie im Hook, ' +
      'nie mit Features. 80/20-Regel beachten. Pointe am Ende. Weiche Frage statt CTA ' +
      '("Was ist in eurem Stack?"). Bei bezahltem Placement gehört #Anzeige an den Anfang.',
  },
  {
    id: 'fomo-member-win',
    name: 'Community-Erfolg',
    description: 'Social Proof: der Erfolg eines Mitglieds, Beweis-Screenshot, Zutritt per Trigger.',
    intent: 'community',
    post_type: 'community_fomo',
    psych_levels: ['social', 'emotional'],
    structure: ['hook', 'beweis_screenshot', 'mitglieds_story', 'was_die_community_beitrug', 'cta_zutritt'],
    hook_formulas: [
      '[name] aus unserer Community hat gerade [ergebnis] erreicht. So lief es ab:',
      'Wahnsinn, was in den letzten 24 h in der Community passiert ist.',
      'Wir sind jetzt [n] [rolle]. Das passiert gerade drinnen:',
    ],
    cta_mechanic: 'comment_trigger',
    style_preset: 'neutral',
    format: 'image_text',
    recommended_platforms: ['linkedin', 'x'],
    anlass_keys: ['community'],
    strategy: {
      ziel: 'Beitritts-Anfragen auslösen: der Erfolg eines Mitglieds beweist, was drinnen möglich ist.',
      warum: [
        'Fremder Erfolg ist der stärkste Beweis — glaubwürdiger als jedes Eigenlob.',
        'Die sichtbare Mechanik (Post → Feedback → Umsetzung) zeigt, wie die Community arbeitet.',
        'Das Trigger-Wort senkt die Beitritts-Hürde auf einen einzigen Kommentar.',
      ],
      benchmarks: [
        {
          metrik: 'Kommentare (Comment-Trigger)',
          wert: '≈ 2–5× vs. Link-Post',
          quelle: 'Comment-to-DM-Funnel-Fallstudien 2025',
        },
      ],
      aufwand: 'mittel',
      frequenz: '1× pro Woche',
      voraussetzungen: [
        'Eigene Community (Skool, Discord, Gruppe)',
        'Einwilligung des Mitglieds (DSGVO)',
        'DMs manuell beantworten (keine Automation)',
      ],
    },
    slots: [
      {
        key: 'mitglied',
        question: 'Wer hat was erreicht? (Vorname + das Ergebnis)',
        help: 'Der echte Erfolg eines echten Mitglieds — mit dessen Einwilligung.',
        example: 'Lena — erste Automation für 500 € verkauft',
        kind: 'fact',
        required: true,
      },
      {
        key: 'zeitraum',
        question: 'Wie lange war das Mitglied dabei, bis das Ergebnis da war?',
        help: 'Macht den Erfolg zeitlich greifbar und glaubwürdig.',
        example: '3 Wochen nach dem Start',
        kind: 'fact',
        required: true,
      },
      {
        key: 'community',
        question: 'Wie heißt deine Community, deren Erfolg du zeigst?',
        help: 'Wird im Post genannt, damit Leser sie finden können.',
        example: 'Automation Circle',
        kind: 'fact',
        required: true,
      },
      {
        key: 'triggerwort',
        question: 'Dein Trigger-Wort für den Zutritt?',
        help: 'Das Wort, das Interessenten kommentieren — kurz und großschreibbar.',
        example: 'LIVE',
        kind: 'angle',
        required: false,
      },
    ],
    prompt_hints:
      'Den Erfolg des MITGLIEDS feiern, nicht den eigenen. Die Mechanik sichtbar machen: ' +
      'Post → Feedback → Umsetzung. Konkrete Aktivitätszahlen nennen. Verknappung nur mit echtem ' +
      'Grund (Preisfenster, Platz-Limit) — kein Dauerdruck. CTA: "Kommentiere [WORT] und ich öffne dir die Tür."',
    manual_steps: [
      'Screenshot anhängen (Einwilligung des Mitglieds einholen — DSGVO).',
      'Aktivitäts- statt Einkommenszahlen zeigen — Einkommens-Screenshots/Erfolgsversprechen sind in DACH wettbewerbsrechtlich heikel (UWG).',
      'Kommentare mit dem Trigger-Wort manuell per DM beantworten — Prolora automatisiert keine DMs.',
    ],
  },
  {
    id: 'crowd-decision',
    name: 'A/B/C-Entscheidung',
    description: 'Crowdsourcing-Umfrage: echte Entscheidung, 2–4 Optionen, Ergebnis wird der nächste Post.',
    intent: 'community',
    post_type: 'crowdsourcing',
    psych_levels: ['social'],
    structure: ['hook', 'kontext_woran_du_arbeitest', 'optionen', 'versprechen', 'cta_abstimmen'],
    hook_formulas: [
      'Ich baue gerade [asset]. Welches Problem soll ich zuerst lösen?',
      'Kurze Frage an alle [zielgruppe]: Was nervt euch an [thema] am meisten — A, B oder C?',
      'Ihr entscheidet, was ich als Nächstes [baue/teste/veröffentliche]:',
    ],
    cta_mechanic: 'poll',
    style_preset: 'neutral',
    format: 'poll',
    recommended_platforms: ['x', 'mastodon', 'linkedin'],
    anlass_keys: ['frage'],
    strategy: {
      ziel: 'Deine Leser zu Mitgestaltern machen — und nebenbei erfahren, was sie wirklich wollen.',
      warum: [
        'Abstimmen ist die niedrigste Beteiligungs-Hürde überhaupt — ein Tap, kein Text.',
        'Wer mitentscheidet, fühlt sich dem Ergebnis verbunden (Ikea-Effekt) und kommt wieder.',
        'Das Ergebnis-Versprechen („Ich teile, was gewinnt") ist ein Open Loop für den Folge-Post.',
      ],
      benchmarks: [
        {
          metrik: 'Reichweite',
          wert: 'Umfragen erhalten überdurchschnittliche Impressions bei minimalem Aufwand',
          quelle: 'X/LinkedIn-Poll-Format-Daten 2025',
        },
      ],
      aufwand: 'niedrig',
      frequenz: '1–2× pro Monat',
      voraussetzungen: ['Eine echte offene Entscheidung (kein Alibi-Poll)'],
    },
    slots: [
      {
        key: 'vorhaben',
        question: 'Woran arbeitest du gerade — und wo stehst du wirklich vor einer Wahl?',
        help: 'Der ehrliche Kontext macht aus der Umfrage eine Geschichte.',
        example: 'Ich baue eine Vorlagen-Bibliothek und weiß nicht, welches Format zuerst',
        kind: 'erfahrung',
        required: true,
      },
      {
        key: 'optionen',
        question: 'Deine 2–4 Optionen (kommagetrennt, eine darf polarisieren)',
        help: 'Klar unterscheidbare Alternativen — die polarisierende zieht die Kommentare.',
        example: 'LinkedIn-Karussells, X-Threads, Telegram-Langform',
        kind: 'angle',
        required: true,
      },
      {
        key: 'termin',
        question: 'Wann teilst du das Ergebnis?',
        help: 'Der konkrete Termin macht dein Versprechen verbindlich (Open Loop).',
        example: 'Freitag, 18 Uhr',
        kind: 'fact',
        required: false,
      },
    ],
    prompt_hints:
      'Nur echte, offene Entscheidungen — Alibi-Polls werden als Engagement-Bait erkannt. ' +
      'Eigener Standpunkt als Reibung im Kontext. Eine "Sonstiges → ab in die Kommentare"-Option ' +
      'ergänzen. Versprechen, das Ergebnis + daraus gebautes Asset zu teilen (Open Loop). ' +
      'Optionen als klar unterscheidbare Text-Zeilen (A) B) C)) formatieren — die Pipeline kann ' +
      'noch keine nativen Polls anlegen.',
    manual_steps: [
      'Wo nativ möglich (X, Mastodon, LinkedIn), die Umfrage zusätzlich als echten Poll anlegen — auf LinkedIn: 3 Optionen, 7 Tage Laufzeit.',
      'Ergebnis am angekündigten Termin als Follow-up-Post teilen.',
    ],
  },
];

export function getTemplateById(id: string): PostTemplate | undefined {
  return TEMPLATE_CATALOG.find((t) => t.id === id);
}
