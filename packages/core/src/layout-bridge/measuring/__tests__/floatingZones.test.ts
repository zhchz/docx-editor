import { describe, expect, test } from 'bun:test';
import {
  findClearLineY,
  MIN_WRAP_SEGMENT_WIDTH,
  rectsToFloatingZones,
  type FloatingImageZone,
} from '../floatingZones';

describe('floating exclusion zones', () => {
  test('splits centered both-sides objects into left and right line segments', () => {
    const [zone] = rectsToFloatingZones(
      [
        {
          side: 'left',
          x: 200,
          y: 0,
          width: 100,
          height: 40,
          distTop: 0,
          distBottom: 0,
          distLeft: 0,
          distRight: 0,
          wrapText: 'bothSides',
        },
      ],
      500
    );

    expect(zone?.segments).toEqual([
      { leftOffset: 0, availableWidth: 200 },
      { leftOffset: 300, availableWidth: 200 },
    ]);
    expect(zone?.leftMargin).toBe(0);
    expect(zone?.rightMargin).toBe(0);
  });

  test('keeps largest-side wrapping on a single side instead of splitting the line', () => {
    const [zone] = rectsToFloatingZones(
      [
        {
          side: 'left',
          x: 100,
          y: 0,
          width: 100,
          height: 40,
          distTop: 0,
          distBottom: 0,
          distLeft: 0,
          distRight: 0,
          wrapText: 'largest',
        },
      ],
      500
    );

    expect(zone?.segments).toBeUndefined();
    expect(zone?.leftMargin).toBe(200);
    expect(zone?.rightMargin).toBe(0);
  });

  test('bothSides with image flush to the right margin falls back to single-side wrap', () => {
    // Image at x=400, width=98, contentWidth=500 → right side has 2 px, far
    // below MIN_WRAP_SEGMENT_WIDTH. Previously this produced a useless
    // 2-px segment that bypassed leftMargin composition with co-occurring
    // floats; now the rect falls through to side='right' → rightMargin set.
    const [zone] = rectsToFloatingZones(
      [
        {
          side: 'right',
          x: 400,
          y: 0,
          width: 98,
          height: 40,
          distTop: 0,
          distBottom: 0,
          distLeft: 0,
          distRight: 0,
          wrapText: 'bothSides',
        },
      ],
      500
    );

    expect(zone?.segments).toBeUndefined();
    expect(zone?.leftMargin).toBe(0);
    expect(zone?.rightMargin).toBe(100);
  });

  test('bothSides keeps splitting when both sides clear the minimum threshold', () => {
    const [zone] = rectsToFloatingZones(
      [
        {
          side: 'left',
          x: MIN_WRAP_SEGMENT_WIDTH + 50,
          y: 0,
          width: 100,
          height: 40,
          distTop: 0,
          distBottom: 0,
          distLeft: 0,
          distRight: 0,
          wrapText: 'bothSides',
        },
      ],
      500
    );

    expect(zone?.segments).toHaveLength(2);
  });
});

describe('findClearLineY', () => {
  const oneZone: FloatingImageZone[] = [{ leftMargin: 480, rightMargin: 0, topY: 0, bottomY: 200 }];

  test('returns startY unchanged when there are no zones', () => {
    expect(findClearLineY(50, 16, undefined, 500, 24)).toBe(50);
    expect(findClearLineY(50, 16, [], 500, 24)).toBe(50);
  });

  test('returns startY when the line already has enough room', () => {
    expect(findClearLineY(300, 16, oneZone, 500, 24)).toBe(300);
  });

  test('hops past a single zone that leaves no usable width', () => {
    expect(findClearLineY(100, 16, oneZone, 500, 24)).toBe(200);
  });

  test('clears stacked zones whose combined margins consume the line', () => {
    const stacked: FloatingImageZone[] = [
      { leftMargin: 300, rightMargin: 0, topY: 0, bottomY: 200 },
      { leftMargin: 0, rightMargin: 250, topY: 0, bottomY: 100 },
    ];
    // At Y=20 both zones overlap; combined margins leave 500-300-250 < 24,
    // so the line hops past the shorter zone (bottomY=100) and re-checks.
    // At Y=100 only the first zone overlaps; width = 200 ≥ 24 → return.
    expect(findClearLineY(20, 16, stacked, 500, 24)).toBe(100);
  });

  test('returns startY when no zone bottom is below the line (cannot progress)', () => {
    const noProgress: FloatingImageZone[] = [
      { leftMargin: 490, rightMargin: 0, topY: -100, bottomY: 50 },
    ];
    // Line at Y=100 doesn't overlap, so the function returns Y=100 directly.
    expect(findClearLineY(100, 16, noProgress, 500, 24)).toBe(100);
  });
});
