// GOAL-RUN7 T5: UI-facing catalog copies are kept separate from the German
// prompt catalog. This preserves stable template IDs and German fallback while
// preventing UI locale from changing the language of generated posts.
import type { AppLocale, PostTemplate, TemplateIntent } from '@prolora/shared';
import { ANLASS_INFO, INTENT_INFO, anlaesseForGoal, type AnlassInfo, type GuideTemplate, type IntentInfo } from './guide';
import CATALOG_LOCALES from './catalog-locales.json';

type Copy = { name: string; description: string };

const TEMPLATE_COPY: Record<'en' | 'es', Record<string, Copy>> = {
  en: {
    'value-listicle': { name: 'The Pattern List', description: 'A numbered value post: one problem, 3–5 useful points, no pitch.' },
    'value-hormozi-carousel': { name: 'Playbook Carousel', description: 'Claim, proof and step-by-step slides that give the playbook away.' },
    'tutorial-asset-funnel': { name: 'How-to with Asset Funnel', description: 'A practical tutorial that offers a real asset in exchange for a comment.' },
    'tutorial-plain': { name: 'Pure Step-by-Step', description: 'A factual tutorial without a funnel, suitable for Mastodon and Telegram too.' },
    'product-time-saved': { name: 'Outcome Demo', description: 'Demonstrate the measurable result instead of listing product features.' },
    'product-automation-loop': { name: 'Automation Loop', description: 'A short screencast loop, value caption and an optional template asset.' },
    'review-honest': { name: '30-Day Verdict', description: 'An honest review with strengths and weaknesses.' },
    'unboxing-first-look': { name: 'First Look', description: 'Expectation, reveal, three first impressions and a promised long-term update.' },
    'transformation-numbers': { name: 'Before/After with Numbers', description: 'A measurable transformation, its decisive lever and credible proof.' },
    'bip-fail-learning': { name: 'Failure of the Day', description: 'Build in public: one failure, its cause and the lesson learned.' },
    'bip-daily-doc': { name: 'Build Log', description: 'A small recurring update: what you built today and one revealing detail.' },
    'lifestyle-stack': { name: 'My Setup / Stack', description: 'A day-in-the-life post where the story leads and the product stays a prop.' },
    'fomo-member-win': { name: 'Community Win', description: 'A member result with consent, proof and an honest invitation.' },
    'crowd-decision': { name: 'A/B/C Decision', description: 'A real decision with 2–4 options and a promised follow-up.' },
  },
  es: {
    'value-listicle': { name: 'La lista de patrones', description: 'Un post de valor numerado: un problema, 3–5 puntos útiles y sin venta.' },
    'value-hormozi-carousel': { name: 'Carrusel de playbook', description: 'Afirmación, prueba y diapositivas paso a paso que comparten todo el método.' },
    'tutorial-asset-funnel': { name: 'Guía con recurso', description: 'Un tutorial práctico que ofrece un recurso real a cambio de un comentario.' },
    'tutorial-plain': { name: 'Paso a paso puro', description: 'Un tutorial objetivo sin embudo, apto también para Mastodon y Telegram.' },
    'product-time-saved': { name: 'Demostración de resultado', description: 'Muestra el resultado medible en lugar de enumerar funciones.' },
    'product-automation-loop': { name: 'Bucle de automatización', description: 'Screencast breve, texto de valor y una plantilla opcional.' },
    'review-honest': { name: 'Veredicto tras 30 días', description: 'Una reseña honesta con puntos fuertes y débiles.' },
    'unboxing-first-look': { name: 'Primera impresión', description: 'Expectativa, revelación, tres impresiones y una futura revisión.' },
    'transformation-numbers': { name: 'Antes/después con cifras', description: 'Una transformación medible, su palanca decisiva y una prueba creíble.' },
    'bip-fail-learning': { name: 'Fallo del día', description: 'Construir en público: un fallo, su causa y el aprendizaje.' },
    'bip-daily-doc': { name: 'Diario de construcción', description: 'Una actualización recurrente: qué construiste hoy y un detalle revelador.' },
    'lifestyle-stack': { name: 'Mi equipo / stack', description: 'Una historia cotidiana donde el producto es un elemento secundario.' },
    'fomo-member-win': { name: 'Logro de la comunidad', description: 'El resultado de un miembro, con permiso, prueba e invitación honesta.' },
    'crowd-decision': { name: 'Decisión A/B/C', description: 'Una decisión real con 2–4 opciones y seguimiento prometido.' },
  },
};

const SLOT_LABELS: Record<'en' | 'es', Record<string, string>> = {
  en: { asset:'asset',aufgabe:'task',beleg:'proof',community:'community',detail:'detail',eindruecke:'impressions',ergebnis:'outcome',ersparnis:'savings',gebaut:'what you built',hebel:'key lever',kernpunkte:'key points',learning:'lesson',link:'link',mitglied:'member',nachher:'after state',optionen:'options',problem:'problem',produkt:'product',rolle:'role',schritte:'steps',schwaechen:'weaknesses',serie:'series',stack:'stack',staerken:'strengths',termin:'date',testzeitraum:'test period',thema:'topic',tools:'tools',triggerwort:'trigger word',ursache:'cause',voraussetzungen:'prerequisites',vorhaben:'plan',vorher:'before state',warum:'reason',was_passiert:'what happens',zeit:'time',zeitraum:'timeframe',zielgruppe:'audience' },
  es: { asset:'recurso',aufgabe:'tarea',beleg:'prueba',community:'comunidad',detail:'detalle',eindruecke:'impresiones',ergebnis:'resultado',ersparnis:'ahorro',gebaut:'lo que construiste',hebel:'palanca clave',kernpunkte:'puntos clave',learning:'aprendizaje',link:'enlace',mitglied:'miembro',nachher:'estado posterior',optionen:'opciones',problem:'problema',produkt:'producto',rolle:'rol',schritte:'pasos',schwaechen:'debilidades',serie:'serie',stack:'stack',staerken:'fortalezas',termin:'fecha',testzeitraum:'periodo de prueba',thema:'tema',tools:'herramientas',triggerwort:'palabra clave',ursache:'causa',voraussetzungen:'requisitos',vorhaben:'plan',vorher:'estado anterior',warum:'motivo',was_passiert:'qué ocurre',zeit:'tiempo',zeitraum:'periodo',zielgruppe:'audiencia' },
};

const INTENT_LABELS: Record<'en' | 'es', Record<TemplateIntent, [string, string]>> = {
  en: { value:['Become visible as an expert','Share knowledge people save and forward.'], product:['Show what your product can do','Demonstrate the outcome, not the feature list.'], community:['Bring people into your community','Show what happens inside and open the door.'], social_proof:['Prove that it works','Use honest experience and before/after evidence.'], personal_brand:['Build your personal brand','Show the journey consistently and recognizably.'] },
  es: { value:['Hazte visible como experto','Comparte conocimiento que la gente guarda y reenvía.'], product:['Muestra lo que puede hacer tu producto','Demuestra el resultado, no la lista de funciones.'], community:['Atrae personas a tu comunidad','Muestra lo que ocurre dentro y abre la puerta.'], social_proof:['Demuestra que funciona','Usa experiencias honestas y pruebas de antes/después.'], personal_brand:['Construye tu marca personal','Muestra el camino con constancia y personalidad.'] },
};

const ANLASS_COPY: Record<'en' | 'es', Record<string, [string, string, string]>> = {
  en: { zahl:['A number or result','Something improved measurably: time, money, reach or revenue.','From six hours to twenty minutes per week.'],wip:['Screenshot, failure or progress','Something real from behind the scenes, especially while unfinished.','A terminal error, unfinished feature or today’s dashboard.'],feature:['Finished feature or workflow','Something works and can be demonstrated step by step.','An automation, setup or new workflow.'],meinung:['Experience with a tool','You used something long enough to name strengths and weaknesses.','Thirty days with a tool: my verdict.'],neu:['Something new arrived','A device, tool or access is new; the first impression happens once.','A new subscription, hardware item or beta access.'],community:['A member success','Someone in your community achieved something, with their consent.','A member sold their first automation.'],frage:['An open decision','You face a real choice and invite readers to help decide.','Which problem should I solve first: A, B or C?'],nichts:['Nothing specific','Knowledge and everyday work are enough; no event is required.','A list, setup post or lesson learned.'] },
  es: { zahl:['Una cifra o resultado','Algo mejoró de forma medible: tiempo, dinero, alcance o ingresos.','De seis horas a veinte minutos por semana.'],wip:['Captura, fallo o avance','Algo real entre bastidores, sobre todo si aún no está terminado.','Un error de terminal, una función incompleta o el panel de hoy.'],feature:['Función o flujo terminado','Algo funciona y puede mostrarse paso a paso.','Una automatización, configuración o flujo nuevo.'],meinung:['Experiencia con una herramienta','La usaste lo suficiente para explicar fortalezas y debilidades.','Treinta días con una herramienta: mi veredicto.'],neu:['Algo nuevo ha llegado','Un dispositivo, herramienta o acceso es nuevo; la primera impresión es única.','Una suscripción, hardware o acceso beta.'],community:['Éxito de un miembro','Alguien de tu comunidad logró algo, con su permiso.','Un miembro vendió su primera automatización.'],frage:['Una decisión abierta','Tienes una elección real e invitas a decidir.','¿Qué problema resuelvo primero: A, B o C?'],nichts:['Nada concreto','El conocimiento y el trabajo diario bastan.','Una lista, una configuración o un aprendizaje.'] },
};

export function localizeCatalog<T extends PostTemplate[]>(catalog: T, locale: AppLocale): T {
  if (locale === 'de') return catalog;
  return catalog.map((template) => {
    const copy = CATALOG_LOCALES[locale].find((item) => item.id === template.id);
    if (!copy) return template;
    return {
      ...template,
      name: copy.name,
      description: copy.description,
      slots: template.slots.map((slot, index) => ({ ...slot, ...copy.slots[index] })),
      strategy: copy.strategy as PostTemplate['strategy'],
      ...(copy.manual_steps ? { manual_steps: copy.manual_steps } : {}),
    };
  }) as T;
}

export function localizedIntentInfo(locale: AppLocale): IntentInfo[] {
  if (locale === 'de') return INTENT_INFO;
  return (Object.keys(INTENT_LABELS[locale]) as TemplateIntent[]).map((key) => {
    const [label, satz] = INTENT_LABELS[locale][key];
    return { key, label, satz, bullets: locale === 'en' ? ['Strategy: lead with one clear idea.','Benefit: useful specifics create trust.','Typical result: more qualified engagement.'] : ['Estrategia: empieza con una idea clara.','Ventaja: los detalles útiles generan confianza.','Resultado típico: interacción más cualificada.'], wann: locale === 'en' ? 'Choose this when it matches the outcome you want from the post.' : 'Elige esta opción cuando coincida con el resultado que buscas.' };
  });
}

export function localizedAnlaesseForGoal(templates: GuideTemplate[], intent: TemplateIntent, locale: AppLocale): AnlassInfo[] {
  const base = anlaesseForGoal(templates, intent);
  if (locale === 'de') return base.length === ANLASS_INFO.length ? ANLASS_INFO : base;
  return base.map((item) => { const [label, beschreibung, beispiel] = ANLASS_COPY[locale][item.key] ?? [item.key, item.key, item.key]; return { key: item.key, label, beschreibung, beispiel }; });
}
