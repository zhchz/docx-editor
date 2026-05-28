/**
 * Strictest OOXML `ST_LongHexNumber` upper bound (exclusive) across the
 * fields this helper feeds: `w14:paraId` / `w14:textId` / comment
 * `paraId` (`< 0x80000000`) and `w16cid:commentId/@durableId`
 * (`< 0x7FFFFFFF`). Generated ids must stay strictly below this value
 * to survive both Word ("Document Recovery — Table Properties") and
 * strict OOXML validators.
 */
export const MAX_HEX_ID_EXCLUSIVE = 0x7fffffff;

/**
 * Random 8-char uppercase hex id, matching Microsoft's `w14:paraId`
 * extension format (also reused for comment `paraId` / `durableId`).
 *
 * Range is `[0, MAX_HEX_ID_EXCLUSIVE)` = `[0, 0x7FFFFFFE]`. See
 * `MAX_HEX_ID_EXCLUSIVE` for why this exact bound.
 *
 * Uses `Math.random()` rather than `crypto.randomUUID()` so the
 * generator works in non-secure contexts (file://, web workers).
 */
export function generateHexId(): string {
  return Math.floor(Math.random() * MAX_HEX_ID_EXCLUSIVE)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
}
