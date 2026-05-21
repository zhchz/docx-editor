/**
 * Font Family Mark Extension
 */

import { createMarkExtension } from '../create';
import { setMark, removeMark } from './markUtils';
import type { FontFamilyAttrs } from '../../schema/marks';
import type { ExtensionContext, ExtensionRuntime } from '../types';
import { orderedFontFamilyCandidates } from '../../../utils/fontResolver';

export const FontFamilyExtension = createMarkExtension({
  name: 'fontFamily',
  schemaMarkName: 'fontFamily',
  markSpec: {
    attrs: {
      ascii: { default: null },
      hAnsi: { default: null },
      eastAsia: { default: null },
      cs: { default: null },
      asciiTheme: { default: null },
      hAnsiTheme: { default: null },
      eastAsiaTheme: { default: null },
      csTheme: { default: null },
    },
    parseDOM: [
      {
        style: 'font-family',
        getAttrs: (value) => {
          const fontValue = value as string;
          const firstFont = fontValue.split(',')[0].trim().replace(/['"]/g, '');
          if (firstFont) {
            return { ascii: firstFont };
          }
          return false;
        },
      },
    ],
    toDOM(mark) {
      const attrs = mark.attrs as FontFamilyAttrs;
      const candidates = orderedFontFamilyCandidates(attrs);
      if (!candidates.length) {
        return ['span', 0];
      }
      const cssValue = `${candidates
        .map((fontName) => (fontName.includes(' ') ? `"${fontName}"` : fontName))
        .join(', ')}, sans-serif`;
      return ['span', { style: `font-family: ${cssValue}` }, 0];
    },
  },
  onSchemaReady(ctx: ExtensionContext): ExtensionRuntime {
    return {
      commands: {
        setFontFamily: (fontName: string) =>
          setMark(ctx.schema.marks.fontFamily, { ascii: fontName, hAnsi: fontName }),
        clearFontFamily: () => removeMark(ctx.schema.marks.fontFamily),
      },
    };
  },
});
