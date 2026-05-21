/**
 * @packageDocumentation
 * @public
 */

import type { Node as PMNode } from 'prosemirror-model';

/**
 * Information about a heading found in the document.
 */
export interface HeadingInfo {
  /** The text content of the heading */
  text: string;
  /** Outline level (0 = Heading 1, 1 = Heading 2, etc.) */
  level: number;
  /** ProseMirror document position of the paragraph node */
  pmPos: number;
}

/**
 * Collect all headings from a ProseMirror document.
 *
 * Detection logic:
 * 1. Trust explicit heading styles (Heading 1 / 标题 1 / 一级标题...)
 * 2. Infer legal-contract Chinese section/subsection headings from text
 * 3. Use `outlineLevel` only when the paragraph text also looks like a heading
 *
 * Some imported DOCX files mark body clauses with `w:outlineLvl`. Treating that
 * flag as truth pollutes the outline with body text such as "12、...".
 */
export function collectHeadings(doc: PMNode): HeadingInfo[] {
  const headings: HeadingInfo[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      const level = node.attrs.outlineLevel;
      const styleId = node.attrs.styleId as string | null;
      const text = extractParagraphText(node);

      let effectiveLevel = styleId ? parseHeadingLevelFromStyleId(styleId) : null;
      if (effectiveLevel == null) {
        effectiveLevel = inferHeadingLevelFromText(text, level);
      }

      if (effectiveLevel != null && effectiveLevel >= 0 && effectiveLevel <= 8) {
        if (text.trim()) {
          headings.push({ text: text.trim(), level: effectiveLevel, pmPos: pos });
        }
      }
    }
  });

  return headings;
}

function parseHeadingLevelFromStyleId(styleId: string): number | null {
  const trimmed = styleId.trim();

  const englishMatch = trimmed.match(/^[Hh]eading\s*(\d)$/);
  if (englishMatch) {
    return parseInt(englishMatch[1], 10) - 1;
  }

  const chineseDigitMatch = trimmed.match(/^标题\s*(\d)$/);
  if (chineseDigitMatch) {
    return parseInt(chineseDigitMatch[1], 10) - 1;
  }

  const chineseNamedLevel = CHINESE_HEADING_LEVELS[trimmed];
  if (chineseNamedLevel != null) {
    return chineseNamedLevel;
  }

  return null;
}

const CHINESE_HEADING_LEVELS: Record<string, number> = {
  一级标题: 0,
  二级标题: 1,
  三级标题: 2,
  四级标题: 3,
  五级标题: 4,
  六级标题: 5,
  七级标题: 6,
  八级标题: 7,
  九级标题: 8,
};

function extractParagraphText(node: PMNode): string {
  let text = '';
  node.forEach((child) => {
    if (child.isText) text += child.text || '';
  });
  return text.trim();
}

function inferHeadingLevelFromText(text: string, outlineLevel: number | null | undefined): number | null {
  if (!text) {
    return null;
  }

  if (isBodyClauseText(text)) {
    return null;
  }

  if (text.length <= 48 && CHINESE_SECTION_HEADING_RE.test(text)) {
    return 0;
  }

  if (text.length <= 48 && CHINESE_SUBSECTION_HEADING_RE.test(text)) {
    return 1;
  }

  if (outlineLevel != null && text.length <= 40 && isStandaloneHeadingText(text)) {
    return outlineLevel;
  }

  return null;
}

const CHINESE_SECTION_HEADING_RE =
  /^[一二三四五六七八九十百千万]+、[^\n\r]{1,44}(?:[：:。；])?$/;

const CHINESE_SUBSECTION_HEADING_RE =
  /^（[一二三四五六七八九十百千万]+）[^\n\r]{1,44}(?:[：:。；])?$/;

function isBodyClauseText(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^\d+(?:\.\d+)*\s*[、.)）]/.test(trimmed) ||
    /^[（(]\d+[）)]/.test(trimmed) ||
    /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(trimmed)
  );
}

function isStandaloneHeadingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40) {
    return false;
  }
  if (/[。；;，,]$/.test(trimmed)) {
    return false;
  }
  if (/[。；;]/.test(trimmed)) {
    return false;
  }
  return /[\u4e00-\u9fa5A-Za-z]/.test(trimmed);
}
