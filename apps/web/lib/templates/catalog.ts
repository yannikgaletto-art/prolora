// Template catalog v1 — pure data, no logic, no DB access (GOAL-RUN4 T0-2,
// Oracle 1). Content mirrors GOAL-RUN4-POST-TEMPLATES.md Appendix A verbatim;
// the research evidence lives in "3) Research/Post-Vorlagen-Recherche-2026-07.md".
// Catalog data (names, questions, hooks) is German by design — it is product
// content for the DACH market, not UI chrome.
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
    slots: [
      { key: 'thema', question: 'Worum geht es? (ein Problem deiner Zielgruppe)', required: true },
      { key: 'kernpunkte', question: 'Deine 3–5 Punkte (kommagetrennt)', required: true },
      { key: 'beleg', question: 'Woher weißt du das? (Zahl, Analyse, Erfahrung)', required: false },
      { key: 'zielgruppe', question: 'Für wen ist das?', required: false, prefill_from: 'target_audience' },
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
    slots: [
      { key: 'thema', question: 'Worum geht es? (ein Thema, eine These)', required: true },
      { key: 'kernpunkte', question: 'Deine 3–5 Kernpunkte (kommagetrennt)', required: true },
      {
        key: 'beleg',
        question: 'Woher weißt du das? (Zahl, Erfahrung, Analyse)',
        required: true,
        prefill_from: 'product_description',
      },
      { key: 'asset', question: 'Welches Asset gibst du gegen einen Kommentar heraus?', required: false },
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
    slots: [
      { key: 'ergebnis', question: 'Was kann der Leser am Ende? (konkretes Ergebnis)', required: true },
      { key: 'schritte', question: 'Nenne die Schritte in Stichworten (3–7, kommagetrennt)', required: true },
      {
        key: 'asset',
        question: 'Welches Asset gibst du gegen einen Kommentar heraus? (z. B. Vorlage, JSON, Checkliste)',
        required: true,
      },
      { key: 'zielgruppe', question: 'Für wen ist das?', required: false, prefill_from: 'target_audience' },
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
    slots: [
      { key: 'ergebnis', question: 'Was kann der Leser am Ende?', required: true },
      { key: 'schritte', question: 'Die Schritte in Stichworten (3–7, kommagetrennt)', required: true },
      { key: 'zeit', question: 'Wie lange dauert es? (z. B. "10 Minuten")', required: false },
      { key: 'voraussetzungen', question: 'Was braucht man vorher? (optional)', required: false },
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
    slots: [
      { key: 'problem', question: 'Welches nervige Problem löst du?', required: true },
      { key: 'ersparnis', question: 'Zeit-/Geld-Ersparnis als Zahl', required: true },
      {
        key: 'produkt',
        question: 'Was ist dein Produkt/Setup? (kurz)',
        required: false,
        prefill_from: 'product_description',
      },
      { key: 'link', question: 'Link (kommt in den ersten Kommentar bzw. den Post)', required: false },
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
    slots: [
      { key: 'aufgabe', question: 'Welche manuelle Aufgabe übernimmt die Automation?', required: true },
      { key: 'ersparnis', question: 'Ersparnis als Zahl (Stunden oder Euro pro Woche)', required: true },
      { key: 'asset', question: 'Welches Template/Asset gibst du heraus?', required: true },
      { key: 'stack', question: 'Womit gebaut? (n8n/Make + APIs, optional)', required: false },
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
    intent: 'value',
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
    slots: [
      { key: 'produkt', question: 'Was hast du getestet?', required: true },
      { key: 'testzeitraum', question: 'Wie lange? (z. B. "30 Tage")', required: true },
      { key: 'staerken', question: '2–3 Stärken (kommagetrennt)', required: true },
      { key: 'schwaechen', question: 'Mindestens 1 ehrlicher Minuspunkt', required: true },
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
    slots: [
      { key: 'produkt', question: 'Was ist angekommen?', required: true },
      { key: 'warum', question: 'Warum gekauft/bestellt? (Erwartung, Hype-Kontext)', required: true },
      { key: 'eindruecke', question: 'Deine 3 ersten Eindrücke (kommagetrennt, gern auch ein irritierender)', required: true },
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
    slots: [
      { key: 'vorher', question: 'Vorher-Zustand als Zahl', required: true },
      { key: 'nachher', question: 'Nachher-Zustand als Zahl', required: true },
      { key: 'zeitraum', question: 'In welchem Zeitraum?', required: true },
      { key: 'hebel', question: 'Der EINE Hebel, der es ausgemacht hat', required: true },
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
    slots: [
      { key: 'was_passiert', question: 'Was ist schiefgegangen? (ungefiltert)', required: true },
      { key: 'ursache', question: 'Woran lag es?', required: true },
      { key: 'learning', question: 'Was ist das Learning / der Fix?', required: true },
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
    slots: [
      { key: 'gebaut', question: 'Was hast du heute gebaut/gelernt?', required: true },
      { key: 'detail', question: 'Das eine interessante Detail', required: true },
      { key: 'serie', question: 'Serien-Nummer (z. B. "Woche 12", optional)', required: false },
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
    slots: [
      { key: 'rolle', question: 'Deine Rolle (z. B. "Solo-Founder")', required: true },
      { key: 'tools', question: '3–5 Tools/Dinge deines Alltags (kommagetrennt)', required: true },
      { key: 'detail', question: 'Ein ehrliches Alltagsdetail (z. B. "zwischen zwei Calls")', required: true },
      {
        key: 'produkt',
        question: 'Dein eigenes Produkt (wird nur beiläufig erwähnt)',
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
    slots: [
      { key: 'mitglied', question: 'Wer hat was erreicht? (Vorname + Ergebnis)', required: true },
      { key: 'zeitraum', question: 'Nach welcher Zeit in der Community?', required: true },
      { key: 'community', question: 'Wie heißt die Community?', required: true },
      { key: 'triggerwort', question: 'Trigger-Wort für den Zutritt (Default: LIVE)', required: false },
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
    slots: [
      { key: 'vorhaben', question: 'Woran arbeitest du gerade?', required: true },
      { key: 'optionen', question: '2–4 Optionen (kommagetrennt, eine davon gern polarisierend)', required: true },
      { key: 'termin', question: 'Wann teilst du das Ergebnis? (optional)', required: false },
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
