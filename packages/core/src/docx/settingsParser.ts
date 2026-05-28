/**
 * settings.xml parser
 *
 * Extracts document-wide settings the layout pipeline needs at render time.
 * We only read what's currently consumed; most of settings.xml (compatibility
 * flags, view state, autoformat) is irrelevant to layout.
 */

import { parseXmlDocument, findChild, getAttribute } from './xmlParser';

/** Document-wide settings parsed from `word/settings.xml`. */
export interface DocumentSettings {
  /**
   * `w:defaultTabStop` (§17.6.13) — interval in twips between default tab
   * stops applied when a paragraph has no custom `w:tabs`. Word's default
   * if unspecified is 720 twips (0.5 inch).
   */
  defaultTabStop: number;
}

/** OOXML default per §17.6.13 when `w:defaultTabStop` is absent. */
export const DEFAULT_TAB_STOP_TWIPS = 720;

/** Sanity cap on `w:defaultTabStop` — Word's max margin is ~22 inches. */
const MAX_TAB_STOP_TWIPS = 31680;

export function parseSettings(xml: string | null): DocumentSettings {
  const root = xml ? parseXmlDocument(xml) : null;
  const el = root ? findChild(root, 'w', 'defaultTabStop') : null;
  const raw = el ? parseInt(getAttribute(el, 'w', 'val') ?? '', 10) : NaN;
  const valid = Number.isFinite(raw) && raw > 0 && raw <= MAX_TAB_STOP_TWIPS;
  return { defaultTabStop: valid ? raw : DEFAULT_TAB_STOP_TWIPS };
}
