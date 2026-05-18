/**
 * Per-run rendering: text, tab, image, line-break, field.
 *
 * `applyRunStyles` is the big block — every run-level OOXML property (font,
 * color, decoration, baseline, scale, kerning, emboss/imprint, emphasis,
 * tracked-change visuals) is mapped to a CSS recipe here. The individual
 * `render*Run` functions wrap a styled span/img/br and apply pm position
 * data attrs for selection mapping.
 */

import type {
  Run,
  TextRun,
  TabRun,
  ImageRun,
  LineBreakRun,
  FieldRun,
} from '../../layout-engine/types';
import type { RenderContext } from '../renderPage';
import { isFloatingImageRun } from '../floatingImageFlow';
import { applyImageVisualAttrs, hasImageVisualAttrs } from '../renderImage';
import { resolveFontFamily } from '../../utils/fontResolver';
import {
  PARAGRAPH_CLASS_NAMES,
  isTextRun,
  isTabRun,
  isImageRun,
  isLineBreakRun,
  isFieldRun,
} from './shared';

/**
 * Apply text run styles to an element
 */
function applyRunStyles(
  element: HTMLElement,
  run: TextRun | TabRun,
  resolvedCommentIds?: Set<number>
): void {
  // Font properties
  if (run.fontFamily) {
    // Use the font resolver for category-appropriate fallback stacks,
    // matching the same stacks used in measureContainer.ts
    element.style.fontFamily = resolveFontFamily(run.fontFamily).cssFallback;
  }
  if (run.fontSize) {
    // fontSize is in points - convert to pixels to match Canvas measurement
    // (1pt = 96/72 px at standard web DPI)
    // Using px ensures consistent rendering with Canvas-based measurements
    const fontSizePx = (run.fontSize * 96) / 72;
    element.style.fontSize = `${fontSizePx}px`;
  }
  if (run.bold) {
    element.style.fontWeight = 'bold';
  }
  if (run.italic) {
    element.style.fontStyle = 'italic';
  }

  // Color
  if (run.color) {
    element.style.color = run.color;
  }

  // Letter spacing
  if (run.letterSpacing) {
    element.style.letterSpacing = `${run.letterSpacing}px`;
  }

  // Caps / small-caps. OOXML w:caps = render glyphs uppercase; w:smallCaps =
  // render lowercase glyphs as small uppercase. Map directly onto the
  // matching CSS properties — same translation the hidden PM toDOM uses.
  if (run.allCaps) {
    element.style.textTransform = 'uppercase';
  }
  if (run.smallCaps) {
    element.style.fontVariant = 'small-caps';
  }

  // Baseline shift (OOXML w:position). Already converted from half-points to
  // CSS px on the bridge; positive raises text the same way CSS does.
  if (run.positionPx) {
    element.style.verticalAlign = `${run.positionPx}px`;
  }

  // Horizontal scale (OOXML w:w). Stored as a percent (100 = normal). Apply
  // via scaleX on an inline-block so the transform actually takes effect.
  if (run.horizontalScale && run.horizontalScale !== 100) {
    element.style.display = 'inline-block';
    element.style.transform = `scaleX(${run.horizontalScale / 100})`;
    element.style.transformOrigin = 'left center';
  }

  // Kerning gate (OOXML w:kern). Enable font-kerning when the run's font
  // size is at or above the threshold; otherwise leave it at the browser
  // default (`auto`). The painter only knows the resolved fontSize at this
  // point — assume the gate is satisfied if a non-zero threshold was set.
  if (run.kerningMinPt && run.kerningMinPt > 0) {
    const fontSizePt = run.fontSize ?? 11;
    if (fontSizePt >= run.kerningMinPt) {
      element.style.fontKerning = 'normal';
    }
  }

  // Cosmetic effect marks (§17.3.2.13/.18/.23/.31/.12). The hidden PM
  // toDOM uses the same CSS recipes — keep them in sync so the painted
  // and editable representations match.
  if (run.emboss) {
    element.style.textShadow = '1px 1px 1px rgba(255,255,255,0.5), -1px -1px 1px rgba(0,0,0,0.3)';
  }
  if (run.imprint) {
    element.style.textShadow = '-1px -1px 1px rgba(255,255,255,0.5), 1px 1px 1px rgba(0,0,0,0.3)';
  }
  if (run.textShadow && !run.emboss && !run.imprint) {
    // Don't double-apply when emboss/imprint already set text-shadow.
    element.style.textShadow = '1px 1px 2px rgba(0,0,0,0.3)';
  }
  if (run.textOutline) {
    element.style.webkitTextStroke = '1px currentColor';
    (element.style as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor =
      'transparent';
  }
  if (run.emphasisMark) {
    const variant =
      run.emphasisMark === 'comma'
        ? 'filled sesame'
        : run.emphasisMark === 'circle'
          ? 'filled circle'
          : 'filled dot';
    const position = run.emphasisMark === 'underDot' ? 'under right' : 'over right';
    element.style.textEmphasis = `${variant}`;
    element.style.textEmphasisPosition = position;
    // Safari prefix.
    (element.style as CSSStyleDeclaration & { webkitTextEmphasis?: string }).webkitTextEmphasis =
      variant;
    (
      element.style as CSSStyleDeclaration & { webkitTextEmphasisPosition?: string }
    ).webkitTextEmphasisPosition = position;
  }

  // Highlight (background color)
  if (run.highlight) {
    element.style.backgroundColor = run.highlight;
  }

  // Text decorations
  const decorations: string[] = [];

  if (run.underline) {
    decorations.push('underline');
    if (typeof run.underline === 'object') {
      if (run.underline.style) {
        element.style.textDecorationStyle = run.underline.style;
      }
      if (run.underline.color) {
        element.style.textDecorationColor = run.underline.color;
      }
    }
  }

  if (run.strike) {
    decorations.push('line-through');
  }

  // Comment highlight (skip for resolved comments)
  if (run.commentIds && run.commentIds.length > 0) {
    const activeCommentId = run.commentIds.find(
      (id) => !resolvedCommentIds || !resolvedCommentIds.has(id)
    );
    if (activeCommentId != null) {
      element.style.backgroundColor = 'rgba(255, 212, 0, 0.15)';
      element.style.borderBottom = '1px solid rgba(255, 212, 0, 0.4)';
      element.dataset.commentId = String(activeCommentId);
    }
  }

  // Tracked insertion styling — light green background with dashed border
  if (run.isInsertion) {
    element.style.backgroundColor = 'rgba(52, 168, 83, 0.08)';
    element.style.borderBottom = '2px dashed #2e7d32';
    element.style.paddingBottom = '1px';
    element.classList.add('docx-insertion');
    if (run.changeAuthor) element.dataset.changeAuthor = run.changeAuthor;
    if (run.changeDate) element.dataset.changeDate = run.changeDate;
    if (run.changeRevisionId != null) element.dataset.revisionId = String(run.changeRevisionId);
  }

  // Tracked deletion styling — light red background with strikethrough
  if (run.isDeletion) {
    element.style.backgroundColor = 'rgba(211, 47, 47, 0.08)';
    element.style.color = '#c62828';
    if (!decorations.includes('line-through')) decorations.push('line-through');
    element.style.textDecorationColor = '#c62828';
    element.classList.add('docx-deletion');
    if (run.changeAuthor) element.dataset.changeAuthor = run.changeAuthor;
    if (run.changeDate) element.dataset.changeDate = run.changeDate;
    if (run.changeRevisionId != null) element.dataset.revisionId = String(run.changeRevisionId);
  }

  if (decorations.length > 0) {
    element.style.textDecorationLine = decorations.join(' ');
  }

  // Superscript/subscript
  if (run.superscript) {
    element.style.verticalAlign = 'super';
    element.style.fontSize = '0.75em';
  }
  if (run.subscript) {
    element.style.verticalAlign = 'sub';
    element.style.fontSize = '0.75em';
  }

  // Hidden run (OOXML w:vanish, §17.3.2.41). In Word's print/normal view
  // hidden text is suppressed entirely, but in *editing* view (which we
  // always are) Word still draws it dimmed with a dotted underline so the
  // author can navigate to and edit it. Mirror that: keep the run in flow
  // and selectable — `display: none` would orphan PM positions and break
  // cursor movement across hidden ranges. A `docx-hidden` class hook lets
  // host CSS swap to print-style suppression when a future view-mode toggle
  // ships.
  if (run.hidden) {
    element.classList.add('docx-hidden');
    element.style.opacity = '0.4';
    element.style.textDecoration = 'underline dotted';
  }

  // Per-run RTL (OOXML w:rtl): flip just this run, independent of the
  // paragraph's bidi direction. The browser's bidi algorithm picks up `dir`
  // automatically from the attribute.
  if (run.rtl) {
    element.setAttribute('dir', 'rtl');
  }

  // Legacy w:effect animations: surface as a class hook so the host CSS
  // can opt in. We avoid applying actual animations because Word's effects
  // are obtrusive and most modern docs treat them as legacy decoration.
  if (run.textEffect) {
    element.classList.add('docx-text-effect', `docx-text-effect-${run.textEffect}`);
    element.dataset.effect = run.textEffect;
  }
}

/**
 * Apply PM position data attributes
 */
export function applyPmPositions(element: HTMLElement, pmStart?: number, pmEnd?: number): void {
  if (pmStart !== undefined) {
    element.dataset.pmStart = String(pmStart);
  }
  if (pmEnd !== undefined) {
    element.dataset.pmEnd = String(pmEnd);
  }
}

/**
 * Render a text run
 */
export function renderTextRun(
  run: TextRun,
  doc: Document,
  resolvedCommentIds?: Set<number>
): HTMLElement {
  const span = doc.createElement('span');
  span.className = `${PARAGRAPH_CLASS_NAMES.run} ${PARAGRAPH_CLASS_NAMES.text}`;

  applyRunStyles(span, run, resolvedCommentIds);
  applyPmPositions(span, run.pmStart, run.pmEnd);

  // Handle hyperlinks
  if (run.hyperlink) {
    const anchor = doc.createElement('a');
    anchor.href = run.hyperlink.href;
    // Internal bookmark links (starting with #) should scroll within the document
    // External links should open in a new tab
    if (!run.hyperlink.href.startsWith('#')) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    if (run.hyperlink.tooltip) {
      anchor.title = run.hyperlink.tooltip;
    }
    anchor.textContent = run.text;
    // Style hyperlink — default Word hyperlink color is blue (#0563c1)
    const hyperlinkColor = run.color || '#0563c1';
    anchor.style.color = hyperlinkColor;
    anchor.style.textDecoration = 'underline';
    // Override span color to match anchor (prevents color mismatch in selection)
    span.style.color = hyperlinkColor;
    span.appendChild(anchor);
  } else {
    // Set text content
    span.textContent = run.text;
  }

  return span;
}

/**
 * Render a tab run with calculated width
 */
export function renderTabRun(
  run: TabRun,
  doc: Document,
  width: number,
  leader?: string
): HTMLElement {
  const span = doc.createElement('span');
  span.className = `${PARAGRAPH_CLASS_NAMES.run} ${PARAGRAPH_CLASS_NAMES.tab}`;

  span.style.display = 'inline-block';
  span.style.width = `${width}px`;
  span.style.overflow = 'hidden';

  applyPmPositions(span, run.pmStart, run.pmEnd);

  // Render leader character if specified
  if (leader && leader !== 'none') {
    const leaderChar = getLeaderChar(leader);
    if (leaderChar) {
      // Fill with leader characters
      span.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='4' height='16'><text x='0' y='12' font-size='12' fill='%23000'>${leaderChar}</text></svg>`
      )}")`;
      span.style.backgroundRepeat = 'repeat-x';
      span.style.backgroundPosition = 'bottom';
    }
  }

  // Tab character for accessibility (but invisible)
  span.textContent = ' '; // Non-breaking space for layout

  return span;
}

/**
 * Get leader character for tab
 */
function getLeaderChar(leader: string): string | null {
  switch (leader) {
    case 'dot':
      return '.';
    case 'hyphen':
      return '-';
    case 'underscore':
      return '_';
    case 'middleDot':
      return '·';
    case 'heavy':
      return '_';
    default:
      return null;
  }
}

/**
 * Parse the rotation angle (in degrees, normalized to [0, 360)) from a
 * `transform` string like `"rotate(90deg) scaleX(-1)"`. Returns 0 when no
 * `rotate()` term is present.
 */
function rotationDegrees(transform: string | undefined): number {
  if (!transform) return 0;
  const m = transform.match(/rotate\(([-\d.]+)deg\)/);
  if (!m) return 0;
  return ((parseFloat(m[1]) % 360) + 360) % 360;
}

/**
 * Axis-aligned bounding box of a rectangle of size `w × h` rotated by
 * `deg` degrees. For multiples of 90° the dims swap (or stay) without
 * floating-point drift; arbitrary angles use the standard formula.
 */
function rotatedBoundingBox(w: number, h: number, deg: number): { w: number; h: number } {
  if (deg === 0 || deg === 180) return { w, h };
  if (deg === 90 || deg === 270) return { w: h, h: w };
  const rad = (deg * Math.PI) / 180;
  const sinA = Math.abs(Math.sin(rad));
  const cosA = Math.abs(Math.cos(rad));
  return { w: w * cosA + h * sinA, h: w * sinA + h * cosA };
}

/**
 * Render an inline image run (flows with text)
 */
function renderInlineImageRun(run: ImageRun, doc: Document): HTMLElement {
  const img = doc.createElement('img');
  img.className = `${PARAGRAPH_CLASS_NAMES.run} ${PARAGRAPH_CLASS_NAMES.image}`;

  img.src = run.src;
  img.width = run.width;
  img.height = run.height;
  // Lock dimensions explicitly: when only the width/height attributes are set,
  // browsers may compute height from the natural aspect ratio (e.g. wp:extent
  // 1771650×278918 EMU rounds to 186×29 px but native 800×126 px gives 29.29 px,
  // overflowing the cell by ~0.3 px and clipping the bottom of the logo).
  img.style.width = `${run.width}px`;
  img.style.height = `${run.height}px`;
  if (run.alt) {
    img.alt = run.alt;
  }
  if (run.transform) {
    img.style.transform = run.transform;
    // Word rotates around the picture's geometric center; the CSS default
    // happens to match, but be explicit so future transforms can't drift.
    img.style.transformOrigin = 'center center';
  }
  if (hasImageVisualAttrs(run)) applyImageVisualAttrs(img, run);

  const deg = rotationDegrees(run.transform);
  if (deg !== 0) {
    // Rotated content extends past `run.width × run.height`, so the inline
    // line box would otherwise reserve too little space and adjacent text
    // would overlap the picture. Wrap the rotated img in a span sized to
    // its axis-aligned bounding box and position the img absolutely at the
    // wrapper's centre so the rotation pivots correctly. This matches
    // Word's behaviour where `wp:extent` reflects the post-rotation bbox
    // and the picture content rotates inside it.
    const bbox = rotatedBoundingBox(run.width, run.height, deg);
    const wrapper = doc.createElement('span');
    wrapper.style.display = 'inline-block';
    wrapper.style.position = 'relative';
    wrapper.style.width = `${bbox.w}px`;
    wrapper.style.height = `${bbox.h}px`;
    wrapper.style.verticalAlign = 'middle';
    img.style.position = 'absolute';
    img.style.left = `${(bbox.w - run.width) / 2}px`;
    img.style.top = `${(bbox.h - run.height) / 2}px`;
    applyPmPositions(wrapper, run.pmStart, run.pmEnd);
    wrapper.appendChild(img);
    return wrapper;
  }

  // Tailwind preflight resets `<img>` to `display: block`, which breaks the
  // inline run flow: an inline image preceded and followed by text would push
  // the trailing text to a new visual row inside the line div, overflowing the
  // measured line height into the next paragraph. `inline-block` keeps the
  // image inside the line's flow while preserving its explicit width/height.
  img.style.display = 'inline-block';

  // Middle alignment — when the line's height was sized with extra leading on
  // both sides (imageH + 2*descent), middle puts the image roughly at line
  // center with visible padding above and below, matching Word's render. (Pure
  // baseline/top would land flush with the line edge.)
  img.style.verticalAlign = 'middle';

  applyPmPositions(img, run.pmStart, run.pmEnd);

  return img;
}

/**
 * Render a block image (on its own line, like topAndBottom)
 */
function renderBlockImage(run: ImageRun, doc: Document): HTMLElement {
  const container = doc.createElement('div');
  container.className = 'layout-block-image';
  container.style.display = 'block';
  container.style.textAlign = 'center';
  container.style.marginTop = `${run.distTop ?? 6}px`;
  container.style.marginBottom = `${run.distBottom ?? 6}px`;

  const img = doc.createElement('img');
  img.src = run.src;
  img.width = run.width;
  img.height = run.height;
  // Global CSS reset (Tailwind preflight) sets img { display: block },
  // which makes text-align: center on the container ineffective.
  // Use margin: auto on the img itself to center it.
  img.style.marginLeft = 'auto';
  img.style.marginRight = 'auto';
  if (run.alt) {
    img.alt = run.alt;
  }
  if (run.transform) {
    img.style.transform = run.transform;
    img.style.transformOrigin = 'center center';
  }
  if (hasImageVisualAttrs(run)) applyImageVisualAttrs(img, run);

  // Reserve the rotated bbox height so the rotated image doesn't bleed into
  // adjacent paragraphs. The container height matches the bbox; the inner
  // img rotates around its own centre, which now lands inside the wrapper.
  const deg = rotationDegrees(run.transform);
  if (deg !== 0) {
    const bbox = rotatedBoundingBox(run.width, run.height, deg);
    container.style.height = `${bbox.h}px`;
    container.style.position = 'relative';
    img.style.position = 'absolute';
    img.style.left = '50%';
    img.style.top = '50%';
    img.style.marginLeft = `${-run.width / 2}px`;
    img.style.marginRight = '0';
    img.style.marginTop = `${-run.height / 2}px`;
  }

  applyPmPositions(container, run.pmStart, run.pmEnd);
  container.appendChild(img);

  return container;
}

/**
 * Render an image run based on its display mode
 * Note: Floating images (square/tight/through) are handled separately at paragraph level,
 * not through this function. If they reach here, render as block.
 */
export function renderImageRun(run: ImageRun, doc: Document): HTMLElement {
  // Floating images should be handled at paragraph level, not here
  // If they reach here (e.g., inside table cells), render as block
  if (isFloatingImageRun(run)) {
    return renderBlockImage(run, doc);
  } else if (run.displayMode === 'block' || run.wrapType === 'topAndBottom') {
    return renderBlockImage(run, doc);
  } else {
    // Default: inline
    return renderInlineImageRun(run, doc);
  }
}

/**
 * Render a line break run
 */
export function renderLineBreakRun(run: LineBreakRun, doc: Document): HTMLElement {
  const br = doc.createElement('br');
  br.className = `${PARAGRAPH_CLASS_NAMES.run} ${PARAGRAPH_CLASS_NAMES.lineBreak}`;

  applyPmPositions(br, run.pmStart, run.pmEnd);

  return br;
}

/**
 * Render a field run (PAGE, NUMPAGES, etc.)
 * Substitutes the field with actual values from context.
 */
export function renderFieldRun(run: FieldRun, doc: Document, context: RenderContext): HTMLElement {
  let text = run.fallback ?? '';

  switch (run.fieldType) {
    case 'PAGE':
      text = String(context.pageNumber);
      break;
    case 'NUMPAGES':
      text = String(context.totalPages);
      break;
    case 'DATE':
      text = new Date().toLocaleDateString();
      break;
    case 'TIME':
      text = new Date().toLocaleTimeString();
      break;
    // OTHER fields use fallback
  }

  // Create a text run with the resolved value
  const resolvedRun: TextRun = {
    kind: 'text',
    text,
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    strike: run.strike,
    color: run.color,
    highlight: run.highlight,
    fontFamily: run.fontFamily,
    fontSize: run.fontSize,
    pmStart: run.pmStart,
    pmEnd: run.pmEnd,
  };

  return renderTextRun(resolvedRun, doc, context?.resolvedCommentIds);
}

/**
 * Render a single run (for non-tab runs)
 */
export function renderRun(run: Run, doc: Document, context?: RenderContext): HTMLElement {
  if (isTextRun(run)) {
    return renderTextRun(run, doc, context?.resolvedCommentIds);
  }
  if (isTabRun(run)) {
    // Tab runs should be handled by renderLine with proper width calculation
    // This is a fallback for cases where tab context isn't available
    return renderTabRun(run, doc, 48, undefined); // Default 0.5 inch tab
  }
  if (isImageRun(run)) {
    return renderImageRun(run, doc);
  }
  if (isLineBreakRun(run)) {
    return renderLineBreakRun(run, doc);
  }
  if (isFieldRun(run) && context) {
    return renderFieldRun(run, doc, context);
  }

  // Fallback for unknown run types
  const span = doc.createElement('span');
  span.className = PARAGRAPH_CLASS_NAMES.run;
  return span;
}
