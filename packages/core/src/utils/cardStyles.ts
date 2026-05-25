/**
 * Sidebar card chrome — shared between React and Vue. Numeric
 * pixel values rather than `'8px'` strings so both adapters'
 * CSSProperties shapes accept them. Lifted from
 * `packages/react/src/components/sidebar/cardStyles.ts` and the
 * Vue mirror so there's one canonical table.
 * @packageDocumentation
 * @public
 */
import type { CSSProperties } from './cssTypes';

export const CARD_STYLE_COLLAPSED: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  backgroundColor: 'var(--doc-review-card-bg-collapsed, #f8fbff)',
  cursor: 'pointer',
  border: '1px solid var(--doc-review-card-border, transparent)',
  boxShadow:
    'var(--doc-review-card-shadow-collapsed, 0 1px 3px rgba(60,64,67,0.2), 0 2px 6px rgba(60,64,67,0.08))',
};

export const CARD_STYLE_EXPANDED: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  backgroundColor: 'var(--doc-review-card-bg-expanded, #fff)',
  cursor: 'pointer',
  border: '1px solid var(--doc-review-card-border, transparent)',
  boxShadow:
    'var(--doc-review-card-shadow-expanded, 0 1px 3px rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15))',
};
