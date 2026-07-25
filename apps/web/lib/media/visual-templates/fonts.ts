// Schriftauflösung für den Template-Renderer (Plan 2 / 2A.6).
//
// satori rendert Text nur mit einem echten Font-Buffer — es gibt keinen
// eingebauten Default. Bewusst wird KEINE Schrift aus dem Netz geladen: das
// wäre eine unangekündigte Laufzeit-Abhängigkeit auf einen fremden Host in
// einem Pfad, der sonst rein lokal ist.
//
// Auflösungsreihenfolge:
//   1. explizit injizierter Buffer (setTemplateFont) — der Weg für Tests und
//      für einen späteren Workspace-eigenen Font,
//   2. VISUAL_TEMPLATE_FONT_PATH aus der Env,
//   3. die mit Next.js ausgelieferte Noto-Sans-Datei (@vercel/og-Bundle).
//
// Findet sich nichts, wirft der Renderer einen sauberen 503 statt zu raten.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const NOTO_RELATIVE = 'dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf';

let injected: Buffer | null = null;
let cached: Buffer | null = null;
let cachedFamily = 'Noto Sans';

/** Für Tests und spätere workspace-eigene Schriften. */
export function setTemplateFont(buffer: Buffer | null, family = 'Noto Sans'): void {
  injected = buffer;
  cached = null;
  cachedFamily = family;
}

export function templateFontFamily(): string {
  return cachedFamily;
}

export function fontCandidatePaths(): string[] {
  const candidates: string[] = [];
  const fromEnv = process.env.VISUAL_TEMPLATE_FONT_PATH?.trim();
  if (fromEnv) candidates.push(fromEnv);

  try {
    const require_ = createRequire(import.meta.url);
    const nextPkg = require_.resolve('next/package.json');
    candidates.push(path.join(path.dirname(nextPkg), NOTO_RELATIVE));
  } catch {
    // Auflösung über package.json-Exports kann blockiert sein — Pfad-Fallbacks unten.
  }

  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.push(path.join(dir, 'node_modules', 'next', NOTO_RELATIVE));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...new Set(candidates)];
}

export async function loadTemplateFont(): Promise<Buffer | null> {
  if (injected) return injected;
  if (cached) return cached;

  for (const candidate of fontCandidatePaths()) {
    try {
      const buffer = await readFile(candidate);
      if (buffer.byteLength > 0) {
        cached = buffer;
        return cached;
      }
    } catch {
      // nächster Kandidat
    }
  }
  return null;
}
