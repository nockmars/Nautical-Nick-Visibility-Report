/**
 * lib/data/__tests__/history-reader.test.ts
 *
 * Tests for the history-reader utility. Uses the real data/history.json
 * (it's checked into the repo) so these are integration-style reads.
 */

import { readHistory, readHistoryRegions } from '../history-reader';

describe('readHistory', () => {
  it('returns an array', () => {
    const entries = readHistory();
    expect(Array.isArray(entries)).toBe(true);
  });

  it('returns entries with expected shape', () => {
    const entries = readHistory();
    expect(entries.length).toBeGreaterThan(0);

    const first = entries[0];
    expect(typeof first.date).toBe('string');
    expect(typeof first.visibility).toBe('number');
    expect(typeof first.rating).toBe('string');
    expect(typeof first.regionSlug).toBe('string');
  });

  it('filters by regionSlug when provided', () => {
    const sd = readHistory('san-diego');
    expect(sd.length).toBeGreaterThan(0);
    sd.forEach(e => expect(e.regionSlug).toBe('san-diego'));
  });

  it('returns empty array for unknown region slug', () => {
    const unknown = readHistory('nonexistent-region');
    expect(unknown).toEqual([]);
  });

  it('dates are in YYYY-MM-DD format', () => {
    const entries = readHistory('san-diego');
    entries.forEach(e => {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('visibility is a positive number', () => {
    const entries = readHistory('san-diego');
    entries.forEach(e => {
      expect(e.visibility).toBeGreaterThan(0);
    });
  });

  it('rating is one of the known strings', () => {
    const VALID_RATINGS = new Set(['POOR', 'FAIR', 'GOOD', 'EXCELLENT', 'EPIC']);
    const entries = readHistory();
    entries.forEach(e => {
      expect(VALID_RATINGS.has(e.rating)).toBe(true);
    });
  });
});

describe('readHistoryRegions', () => {
  it('returns known regions', () => {
    const regions = readHistoryRegions();
    expect(regions).toContain('san-diego');
    expect(regions).toContain('orange-county');
    expect(regions).toContain('la-county');
    expect(regions).toContain('catalina-island');
  });

  it('returns an array of strings', () => {
    const regions = readHistoryRegions();
    expect(Array.isArray(regions)).toBe(true);
    regions.forEach(r => expect(typeof r).toBe('string'));
  });
});
