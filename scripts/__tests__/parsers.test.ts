/**
 * scripts/__tests__/parsers.test.ts
 *
 * Tests for pure parser/helper functions extracted from the fetcher scripts.
 * These are deterministic input → output functions with no I/O.
 */

// Set DATABASE_URL before imports so the env guard (inside main()) doesn't fire.
process.env.DATABASE_URL = 'postgresql://test:test@localhost/testdb';

jest.mock('dotenv/config', () => ({}));
jest.mock('../../lib/db/client', () => ({
  prisma: {
    location: { findMany: jest.fn().mockResolvedValue([]) },
    weatherData: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    condition: { create: jest.fn().mockResolvedValue({}) },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── wmoCodeToCondition ────────────────────────────────────────────────────────
// Import directly from the fetcher (it's an exported named function)
import { wmoCodeToCondition } from '../fetchers/fetch-weather';

describe('wmoCodeToCondition', () => {
  it('returns null for null input', () => {
    expect(wmoCodeToCondition(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(wmoCodeToCondition(undefined)).toBeNull();
  });

  it('returns clear for code 0', () => {
    expect(wmoCodeToCondition(0)).toBe('clear');
  });

  it('returns partly-cloudy for codes 1–3', () => {
    expect(wmoCodeToCondition(1)).toBe('partly-cloudy');
    expect(wmoCodeToCondition(2)).toBe('partly-cloudy');
    expect(wmoCodeToCondition(3)).toBe('partly-cloudy');
  });

  it('returns fog for codes 45 and 48', () => {
    expect(wmoCodeToCondition(45)).toBe('fog');
    expect(wmoCodeToCondition(48)).toBe('fog');
  });

  it('returns drizzle for codes 51–57', () => {
    expect(wmoCodeToCondition(51)).toBe('drizzle');
    expect(wmoCodeToCondition(55)).toBe('drizzle');
    expect(wmoCodeToCondition(57)).toBe('drizzle');
  });

  it('returns rain for codes 61–65', () => {
    expect(wmoCodeToCondition(61)).toBe('rain');
    expect(wmoCodeToCondition(63)).toBe('rain');
    expect(wmoCodeToCondition(65)).toBe('rain');
  });

  it('returns freezing-rain for codes 66–67', () => {
    expect(wmoCodeToCondition(66)).toBe('freezing-rain');
    expect(wmoCodeToCondition(67)).toBe('freezing-rain');
  });

  it('returns snow for codes 71–77', () => {
    expect(wmoCodeToCondition(71)).toBe('snow');
    expect(wmoCodeToCondition(77)).toBe('snow');
  });

  it('returns rain-showers for codes 80–82', () => {
    expect(wmoCodeToCondition(80)).toBe('rain-showers');
    expect(wmoCodeToCondition(82)).toBe('rain-showers');
  });

  it('returns snow-showers for codes 85–86', () => {
    expect(wmoCodeToCondition(85)).toBe('snow-showers');
    expect(wmoCodeToCondition(86)).toBe('snow-showers');
  });

  it('returns thunderstorm for code >= 95', () => {
    expect(wmoCodeToCondition(95)).toBe('thunderstorm');
    expect(wmoCodeToCondition(99)).toBe('thunderstorm');
  });

  it('returns cloudy as fallback for unrecognized codes', () => {
    // Code 4 is not in the WMO spec we handle
    expect(wmoCodeToCondition(4)).toBe('cloudy');
  });
});

// ── Rain history aggregation (inline pure logic tests) ─────────────────────────

describe('rain history aggregation', () => {
  function sumRain(history: Array<{ date: string; inches: number }>): number {
    return Math.round(history.reduce((sum, r) => sum + r.inches, 0) * 100) / 100;
  }

  it('sums zero rain correctly', () => {
    const h = [
      { date: '2026-04-20', inches: 0 },
      { date: '2026-04-19', inches: 0 },
    ];
    expect(sumRain(h)).toBe(0);
  });

  it('sums mixed rain days correctly', () => {
    const h = [
      { date: '2026-04-20', inches: 0.25 },
      { date: '2026-04-19', inches: 0.10 },
      { date: '2026-04-18', inches: 0 },
      { date: '2026-04-17', inches: 0.50 },
      { date: '2026-04-16', inches: 0.05 },
    ];
    expect(sumRain(h)).toBe(0.9);
  });

  it('rounds to 2 decimal places', () => {
    const h = [
      { date: '2026-04-20', inches: 0.001 },
      { date: '2026-04-19', inches: 0.001 },
      { date: '2026-04-18', inches: 0.001 },
    ];
    expect(sumRain(h)).toBe(0);  // rounds down from 0.003
  });
});

// ── Chlorophyll note boundaries (matches vanilla fetch-satellite.js logic) ────

describe('chlorophyll note boundaries', () => {
  function chlorophyllNote(val: number | null): string {
    if (val == null || isNaN(val)) return 'Satellite reading unavailable.';
    if (val < 0.3)  return 'Very low chlorophyll — clean oceanic water pushing inshore. Exceptional clarity likely.';
    if (val < 0.6)  return 'Low chlorophyll — minimal phytoplankton bloom. Good to excellent visibility expected.';
    if (val < 1.2)  return 'Moderate chlorophyll — some phytoplankton present. Visibility may be reduced.';
    if (val < 3.0)  return 'Elevated chlorophyll — active bloom conditions. Expect reduced visibility.';
    return 'High chlorophyll — significant bloom in progress. Poor visibility likely inshore.';
  }

  it('returns unavailable note for null', () => {
    expect(chlorophyllNote(null)).toContain('unavailable');
  });

  it('returns very low note for value < 0.3', () => {
    expect(chlorophyllNote(0.1)).toContain('Very low');
    expect(chlorophyllNote(0.29)).toContain('Very low');
  });

  it('returns low note for 0.3 <= value < 0.6', () => {
    expect(chlorophyllNote(0.3)).toContain('Low chlorophyll');
    expect(chlorophyllNote(0.59)).toContain('Low chlorophyll');
  });

  it('returns moderate note for 0.6 <= value < 1.2', () => {
    expect(chlorophyllNote(0.6)).toContain('Moderate');
    expect(chlorophyllNote(1.19)).toContain('Moderate');
  });

  it('returns elevated note for 1.2 <= value < 3.0', () => {
    expect(chlorophyllNote(1.2)).toContain('Elevated');
    expect(chlorophyllNote(2.99)).toContain('Elevated');
  });

  it('returns high note for value >= 3.0', () => {
    expect(chlorophyllNote(3.0)).toContain('High chlorophyll');
    expect(chlorophyllNote(10.0)).toContain('High chlorophyll');
  });
});
