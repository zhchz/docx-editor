/**
 * Paragraph Fragment Renderer
 *
 * Renders paragraph fragments with lines and text runs to DOM.
 * Handles text formatting, alignment, and positioning.
 *
 * This file owns `renderParagraphFragment` (the orchestrator), the
 * border-grouping helpers, and the list-marker renderer. Per-run rendering
 * (text/tab/image/break/field) lives in ./renderParagraph/runs.ts and the
 * line-level walker is in ./renderParagraph/line.ts. The shared class-name
 * constants and run-type guards are in ./renderParagraph/shared.ts.
 */

import type {
  ParagraphBlock,
  ParagraphMeasure,
  ParagraphFragment,
  ParagraphIndent,
  ParagraphBorders,
  BorderStyle,
  MeasuredLine,
  TextRun,
} from '../layout-engine/types';
import type { RenderContext } from './renderPage';
import { resolveFontFamily } from '../utils/fontResolver';
import { PARAGRAPH_CLASS_NAMES } from './renderParagraph/shared';
import { applyPmPositions } from './renderParagraph/runs';
import { renderLine } from './renderParagraph/line';

export { PARAGRAPH_CLASS_NAMES } from './renderParagraph/shared';
export { sliceRunsForLine, renderLine } from './renderParagraph/line';

/**
 * Options for rendering a paragraph
 */
export interface RenderParagraphOptions {
  /** Document to create elements in */
  document?: Document;
  /** Fragment's Y position relative to content area (for per-line margin calculation) */
  fragmentContentY?: number;
  /** Borders from the previous adjacent paragraph (for border grouping) */
  prevBorders?: ParagraphBorders;
  /** Borders from the next adjacent paragraph (for border grouping) */
  nextBorders?: ParagraphBorders;
  /** Inline image runs already rendered for this paragraph block */
  renderedInlineImageKeys?: Set<string>;
}

/**
 * Check if two individual border definitions are equal (same style, width, color).
 */
function bordersEqual(a?: BorderStyle, b?: BorderStyle): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.style === b.style && a.width === b.width && a.color === b.color;
}

/**
 * Check if two ParagraphBorders form a group (ECMA-376 §17.3.1.24).
 * Adjacent paragraphs with identical border definitions belong to the same group.
 */
function bordersFormGroup(a?: ParagraphBorders, b?: ParagraphBorders): boolean {
  if (!a && !b) return false; // no borders = no group
  if (!a || !b) return false;
  return (
    bordersEqual(a.top, b.top) &&
    bordersEqual(a.bottom, b.bottom) &&
    bordersEqual(a.left, b.left) &&
    bordersEqual(a.right, b.right) &&
    bordersEqual(a.between, b.between)
  );
}

/**
 * Render a paragraph fragment
 *
 * @param fragment - The fragment to render
 * @param block - The paragraph block
 * @param measure - The paragraph measurement
 * @param context - Rendering context
 * @param options - Rendering options
 * @returns The fragment DOM element
 */
export function renderParagraphFragment(
  fragment: ParagraphFragment,
  block: ParagraphBlock,
  measure: ParagraphMeasure,
  context: RenderContext,
  options: RenderParagraphOptions = {}
): HTMLElement {
  const doc = options.document ?? document;

  const fragmentEl = doc.createElement('div');
  fragmentEl.className = PARAGRAPH_CLASS_NAMES.fragment;
  // Outer positioning honors the render context. Body's per-page layout
  // overrides this anyway via applyFragmentStyles (legacy default), but
  // HF callers explicitly pass `positioning: 'absolute'` and textbox
  // callers pass `positioning: 'flow'` — keeps the choice in the
  // RenderContext rather than scattered post-render style flips (#379).
  // 'flow' / unspecified default to relative because the element must
  // be a containing block for absolutely positioned floating images.
  fragmentEl.style.position = context.positioning === 'absolute' ? 'absolute' : 'relative';

  // Store block and fragment metadata
  fragmentEl.dataset.blockId = String(fragment.blockId);
  fragmentEl.dataset.fromLine = String(fragment.fromLine);
  fragmentEl.dataset.toLine = String(fragment.toLine);

  applyPmPositions(fragmentEl, fragment.pmStart, fragment.pmEnd);

  if (fragment.continuesFromPrev) {
    fragmentEl.dataset.continuesFromPrev = 'true';
  }
  if (fragment.continuesOnNext) {
    fragmentEl.dataset.continuesOnNext = 'true';
  }

  // Text wrapping around floating images is handled at measurement time via
  // per-line leftOffset/rightOffset in MeasuredLine. Floating images themselves
  // skip inline rendering - they're rendered at page level.
  // NOTE: Floating images are rendered at page level in renderPage.ts for
  // cross-paragraph positioning. Inside table cells, they render in-flow
  // since page-level extraction doesn't reach into cell paragraphs.

  // Get the lines for this fragment
  const lines = measure.lines.slice(fragment.fromLine, fragment.toLine);
  const alignment = block.attrs?.alignment;

  // Apply paragraph-level styles
  if (block.attrs?.styleId) {
    fragmentEl.dataset.styleId = block.attrs.styleId;
  }

  // Paginator owns vertical positioning; spacing.before/after are baked
  // into fragment.y, not applied as wrapper padding (would double-count).

  // Apply RTL direction
  const isBidi = block.attrs?.bidi;
  if (isBidi) {
    fragmentEl.dir = 'rtl';
  }

  // Apply text alignment at paragraph level
  // For justify: use text-align: left and apply word-spacing per line
  // For RTL paragraphs, default alignment is right
  if (alignment) {
    if (alignment === 'center') {
      fragmentEl.style.textAlign = 'center';
    } else if (alignment === 'right') {
      fragmentEl.style.textAlign = 'right';
    } else if (alignment === 'left') {
      fragmentEl.style.textAlign = 'left';
    } else {
      // 'justify' uses text-align: left (or right for RTL)
      // Justify is implemented via word-spacing on individual lines
      fragmentEl.style.textAlign = isBidi ? 'right' : 'left';
    }
  } else if (isBidi) {
    // No explicit alignment on RTL paragraph — default to right
    fragmentEl.style.textAlign = 'right';
  }

  // Track indentation for line-level application
  // Indentation is applied per-line, not at fragment level
  const indent = block.attrs?.indent;
  let indentLeft = 0;
  let indentRight = 0;

  if (indent) {
    // Track indent values for line-level application
    // For RTL paragraphs, swap left/right indentation
    if (isBidi) {
      if (indent.left && indent.left > 0) indentRight = indent.left;
      if (indent.right && indent.right > 0) indentLeft = indent.right;
    } else {
      if (indent.left && indent.left > 0) indentLeft = indent.left;
      if (indent.right && indent.right > 0) indentRight = indent.right;
    }
  }

  // Note: Line spacing is applied per-line div (renderLine sets lineEl.style.height
  // and lineEl.style.lineHeight), not at fragment level. Fragment-level line-height
  // was removed to avoid conflicts with the explicit per-line pixel heights.

  // Apply borders
  const borders = block.attrs?.borders;
  if (borders) {
    const borderStyleToCss = (style?: string): string => {
      // Map OOXML border styles to CSS
      switch (style) {
        case 'single':
          return 'solid';
        case 'double':
          return 'double';
        case 'dotted':
          return 'dotted';
        case 'dashed':
          return 'dashed';
        case 'thick':
          return 'solid';
        case 'wave':
          return 'wavy';
        case 'dashSmallGap':
          return 'dashed';
        case 'nil':
        case 'none':
          return 'none';
        default:
          return 'solid';
      }
    };

    // Ensure box-sizing is set for proper border calculations
    fragmentEl.style.boxSizing = 'border-box';

    const borderToCss = (b: BorderStyle) => `${b.width}px ${borderStyleToCss(b.style)} ${b.color}`;

    // Word-style border grouping (ECMA-376 §17.3.1.24):
    // Adjacent paragraphs with identical pBdr form a group.
    // - top border → only on the first paragraph of the group
    // - bottom border → only on the last paragraph of the group
    // - between border → rendered as borderTop on interior paragraphs
    // - left/right → on every paragraph in the group
    const groupedWithPrev = bordersFormGroup(options.prevBorders, borders);
    const groupedWithNext = bordersFormGroup(borders, options.nextBorders);

    const renderedTopBorder = groupedWithPrev ? borders.between : borders.top;
    const renderedBottomBorder = !groupedWithNext ? borders.bottom : undefined;

    const borderBox = doc.createElement('div');
    borderBox.className = 'layout-paragraph-border';
    borderBox.style.position = 'absolute';
    borderBox.style.pointerEvents = 'none';
    borderBox.style.boxSizing = 'border-box';
    borderBox.style.left = `${indentLeft - (borders.left?.space ?? 0)}px`;
    borderBox.style.right = `${indentRight - (borders.right?.space ?? 0)}px`;
    borderBox.style.top = `${-(renderedTopBorder?.space ?? 0)}px`;
    borderBox.style.bottom = `${-(renderedBottomBorder?.space ?? 0)}px`;

    if (renderedTopBorder) {
      borderBox.style.borderTop = borderToCss(renderedTopBorder);
    }
    if (renderedBottomBorder) {
      borderBox.style.borderBottom = borderToCss(renderedBottomBorder);
    }
    if (borders.left) {
      borderBox.style.borderLeft = borderToCss(borders.left);
    }
    if (borders.right) {
      borderBox.style.borderRight = borderToCss(borders.right);
    }

    const hasBorder = renderedTopBorder || renderedBottomBorder || borders.left || borders.right;
    if (hasBorder) {
      fragmentEl.appendChild(borderBox);
    }

    // Bar border — vertical decorative bar on the left side (ECMA-376 §17.3.1.4)
    // Rendered independently of the regular left border
    if (borders.bar) {
      const barEl = doc.createElement('div');
      barEl.style.position = 'absolute';
      barEl.style.left = '-8px';
      barEl.style.top = '0';
      barEl.style.bottom = '0';
      barEl.style.borderLeft = borderToCss(borders.bar);
      fragmentEl.style.position = 'relative';
      fragmentEl.appendChild(barEl);
    }
  }

  // Apply shading (background color)
  if (block.attrs?.shading) {
    fragmentEl.style.backgroundColor = block.attrs.shading;
  }

  // Calculate available width for justify
  // Subtract indentation since those are applied as CSS margins on the fragment
  const availableWidth = fragment.width - indentLeft - indentRight;

  // Check if paragraph ends with line break (for justify last line handling)
  const lastRun = block.runs[block.runs.length - 1];
  const paragraphEndsWithLineBreak = lastRun?.kind === 'lineBreak';

  // Total number of lines in the paragraph (not just this fragment)
  const totalLines = measure.lines.length;

  // Calculate first line indent for tab positioning
  // Hanging indent is stored as positive value but means negative offset for first line
  let firstLineIndentPx = 0;
  if (indent?.hanging && indent.hanging > 0) {
    firstLineIndentPx = -indent.hanging; // Negative because first line starts further left
  } else if (indent?.firstLine && indent.firstLine > 0) {
    firstLineIndentPx = indent.firstLine; // Positive because first line is indented right
  }

  // Render each line with per-line floating margin calculation
  const renderedInlineImageKeys = options.renderedInlineImageKeys ?? new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Calculate the actual line index in the full paragraph
    const lineIndex = fragment.fromLine + i;
    const isLastLine = lineIndex === totalLines - 1;
    // First line of the paragraph (not just this fragment)
    const isFirstLine = lineIndex === 0 && !fragment.continuesFromPrev;

    // Get per-line floating margins from measurement phase
    const lineLeftOffset = line.leftOffset ?? 0;
    const lineRightOffset = line.rightOffset ?? 0;

    // For first line, adjust available width for hanging/firstLine indent
    // Measurement uses: baseFirstLineWidth = bodyContentWidth - (firstLine - hanging)
    // So hanging gives MORE width, firstLine gives LESS width
    let lineAvailableWidth = availableWidth;
    if (isFirstLine) {
      const hasHangingIndent = indent?.hanging && indent.hanging > 0;
      const hasFirstLineIndent = indent?.firstLine && indent.firstLine > 0;
      if (hasHangingIndent && indent?.hanging) {
        lineAvailableWidth = availableWidth + indent.hanging;
      } else if (hasFirstLineIndent && indent?.firstLine) {
        lineAvailableWidth = availableWidth - indent.firstLine;
      }
    }

    if (canRenderSplitLineAroundFloatingObject(line, block)) {
      const splitLineEl = doc.createElement('div');
      splitLineEl.className = `${PARAGRAPH_CLASS_NAMES.line} layout-line-split`;
      splitLineEl.style.position = 'relative';
      splitLineEl.style.height = `${line.lineHeight}px`;
      splitLineEl.style.lineHeight = `${line.lineHeight}px`;

      for (const segment of line.segments) {
        const segmentLine: MeasuredLine = {
          fromRun: segment.fromRun,
          fromChar: segment.fromChar,
          toRun: segment.toRun,
          toChar: segment.toChar,
          width: segment.width,
          ascent: line.ascent,
          descent: line.descent,
          lineHeight: line.lineHeight,
        };
        const segmentEl = renderLine(block, segmentLine, alignment, doc, {
          availableWidth: segment.availableWidth,
          isLastLine,
          isFirstLine,
          paragraphEndsWithLineBreak,
          tabStops: block.attrs?.tabs,
          leftIndentPx: indentLeft,
          firstLineIndentPx: isFirstLine ? firstLineIndentPx : 0,
          context,
          floatingMargins: { leftMargin: 0, rightMargin: 0 },
          renderedInlineImageKeys,
        });
        segmentEl.className += ' layout-line-segment';
        segmentEl.style.position = 'absolute';
        segmentEl.style.left = `${segment.leftOffset}px`;
        segmentEl.style.top = '0';
        segmentEl.style.width = `${segment.availableWidth}px`;
        splitLineEl.appendChild(segmentEl);
      }

      fragmentEl.appendChild(splitLineEl);
      continue;
    }

    const lineEl = renderLine(block, line, alignment, doc, {
      availableWidth: lineAvailableWidth - lineLeftOffset - lineRightOffset,
      isLastLine,
      isFirstLine,
      paragraphEndsWithLineBreak,
      tabStops: block.attrs?.tabs,
      leftIndentPx: indentLeft,
      firstLineIndentPx: isFirstLine ? firstLineIndentPx : 0,
      context,
      floatingMargins: { leftMargin: lineLeftOffset, rightMargin: lineRightOffset },
      renderedInlineImageKeys,
    });

    // Apply left offset from floating images (lines start after the floating image)
    // Also constrain width so text doesn't overflow into the image area
    if (lineLeftOffset > 0 || lineRightOffset > 0) {
      if (lineLeftOffset > 0) {
        lineEl.style.marginLeft = `${lineLeftOffset}px`;
      }
      if (lineRightOffset > 0) {
        lineEl.style.marginRight = `${lineRightOffset}px`;
      }
      // Constrain line width to prevent text from extending into floating image area
      const constrainedWidth = lineAvailableWidth - lineLeftOffset - lineRightOffset;
      if (constrainedWidth > 0) {
        lineEl.style.width = `${constrainedWidth}px`;
      }
    }

    // Apply line-level indentation
    // Indentation is applied per-line for correct text wrapping
    const hasHanging = indent?.hanging && indent.hanging > 0;
    const hasFirstLine = indent?.firstLine && indent.firstLine > 0;

    if (isFirstLine) {
      // First line handling
      if (indentLeft > 0 && hasHanging) {
        // Hanging indent: first line starts at (indentLeft - hanging)
        lineEl.style.paddingLeft = `${indentLeft}px`;
        lineEl.style.textIndent = `-${indent!.hanging}px`;
      } else if (indentLeft > 0 && hasFirstLine) {
        // First line indent: first line starts at (indentLeft + firstLine)
        lineEl.style.paddingLeft = `${indentLeft}px`;
        lineEl.style.textIndent = `${indent!.firstLine}px`;
      } else if (indentLeft > 0) {
        // Just left indent, no special first line treatment
        lineEl.style.paddingLeft = `${indentLeft}px`;
      } else if (hasFirstLine) {
        // No left indent, but has first line indent
        lineEl.style.textIndent = `${indent!.firstLine}px`;
      }
      // No hanging without left indent (handled by firstLineOffset in measurement)
    } else {
      // Body lines (not first line)
      if (indentLeft > 0) {
        lineEl.style.paddingLeft = `${indentLeft}px`;
      } else if (hasHanging) {
        // Hanging indent without left indent: body lines need padding = hanging
        lineEl.style.paddingLeft = `${indent!.hanging}px`;
      }
    }

    if (indentRight > 0) {
      lineEl.style.paddingRight = `${indentRight}px`;
    }

    // Add list marker to first line
    // List first lines have special handling:
    // - Marker starts at (indentLeft - hanging)
    // - Text starts at indentLeft
    // - The marker box fills the hanging space
    if (isFirstLine && block.attrs?.listMarker && !block.attrs?.listMarkerHidden) {
      // Override padding for list first lines
      // Marker position = indentLeft - hanging (where first line content starts)
      const markerPos = Math.max(0, indentLeft - (indent?.hanging ?? 0));
      lineEl.style.paddingLeft = `${markerPos}px`;
      lineEl.style.textIndent = '0'; // Don't use textIndent for lists

      // Resolve marker font per ECMA-376 §17.9.6:
      // 1. Numbering level rPr (explicit marker font)
      // 2. First text run's font (paragraph content)
      // 3. Paragraph default font (from style)
      let firstTextRun: TextRun | undefined;
      if (!block.attrs.listMarkerFontFamily || !block.attrs.listMarkerFontSize) {
        for (let ri = line.fromRun; ri <= line.toRun; ri++) {
          const r = block.runs[ri];
          if (r && r.kind === 'text') {
            firstTextRun = r;
            break;
          }
        }
      }
      const markerFontFamily =
        block.attrs.listMarkerFontFamily ??
        firstTextRun?.fontFamily ??
        block.attrs.defaultFontFamily;
      const markerFontSize =
        block.attrs.listMarkerFontSize ?? firstTextRun?.fontSize ?? block.attrs.defaultFontSize;

      const marker = renderListMarker(
        block.attrs.listMarker,
        indent,
        doc,
        markerFontFamily,
        markerFontSize
      );
      // With no hanging indent slot reserved for the marker, Word's default
      // tab suffix wraps the body text below the marker (§17.9.25). We mirror
      // that by giving the marker its own line, sized to match line height.
      const hanging = indent?.hanging ?? 0;
      if (hanging > 0) {
        lineEl.insertBefore(marker, lineEl.firstChild);
      } else {
        const markerLine = doc.createElement('div');
        markerLine.className = 'layout-line layout-list-marker-line';
        markerLine.style.height = `${line.lineHeight}px`;
        markerLine.style.lineHeight = `${line.lineHeight}px`;
        markerLine.appendChild(marker);
        fragmentEl.appendChild(markerLine);
      }
    }

    // Append line directly to fragment (per-line margins are applied in renderLine)
    fragmentEl.appendChild(lineEl);
  }

  return fragmentEl;
}

function canRenderSplitLineAroundFloatingObject(
  line: MeasuredLine,
  block: ParagraphBlock
): line is MeasuredLine & { segments: NonNullable<MeasuredLine['segments']> } {
  return (line.segments?.length ?? 0) > 1 && !block.attrs?.listMarker;
}

/**
 * Render a list marker element
 *
 * The marker is rendered as an inline-block with a consistent space after it.
 * For short markers, the box fills the hanging indent area.
 * For long markers (like "1.1.1"), we ensure minimum spacing after the text.
 */
function renderListMarker(
  marker: string,
  indent: ParagraphIndent | undefined,
  doc: Document,
  fontFamily?: string,
  fontSize?: number
): HTMLElement {
  const span = doc.createElement('span');
  span.className = 'layout-list-marker';

  // Apply font styling so the marker matches the paragraph text
  // Per ECMA-376 §17.9.6, marker formatting comes from level rPr,
  // then paragraph defaults, then document defaults.
  if (fontFamily) {
    span.style.fontFamily = resolveFontFamily(fontFamily).cssFallback;
  }
  if (fontSize) {
    // Convert points to pixels: 1pt = 96/72 px
    const fontSizePx = (fontSize * 96) / 72;
    span.style.fontSize = `${fontSizePx}px`;
  }

  span.textContent = marker;
  span.style.textAlign = 'left';
  span.style.boxSizing = 'border-box';

  // When a hanging indent reserves space for the marker, render inline-block
  // so the marker sits in that slot. With no hanging indent the caller wraps
  // the marker in its own line element instead.
  const hanging = indent?.hanging ?? 0;
  span.style.display = 'inline-block';
  if (hanging > 0) {
    span.style.minWidth = `${hanging}px`;
  }

  return span;
}
