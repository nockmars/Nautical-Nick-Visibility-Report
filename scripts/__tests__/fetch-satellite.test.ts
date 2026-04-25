/**
 * scripts/__tests__/fetch-satellite.test.ts
 *
 * Tests for the satellite fetcher's fallback chain behavior.
 * Calls the exported `fetchWithFallbackChain` function directly to avoid
 * triggering `main()` at import time.
 *
 * Mocks:
 *   - axios (all HTTP) — controlled per test
 *   - lib/db/client prisma — in-memory mock, no real DB
 *
 * Scenarios:
 *   A. Primary source returns valid data → stale=false, source=noaa-coastwatch
 *   B. Primary fails, secondary succeeds → stale=false, source=noaa-westcoast
 *   C. All sources fail, prior DB row exists → stale=true, source=cached
 *   D. All sources fail, no prior DB row → stale=true, source=unavailable, valueMgM3=null
 */

// Set DATABASE_URL before any import so the module-level guard (now inside main()) passes.
process.env.DATABASE_URL = 'postgresql://test:test@localhost/testdb';

jest.mock('axios');
jest.mock('dotenv/config', () => ({}));

import axios from 'axios';
const axiosMock = axios as jest.Mocked<typeof axios>;

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockChlorophyllFindFirst = jest.fn();
const mockChlorophyllCreate    = jest.fn().mockResolvedValue({});
const mockDisconnect           = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/db/client', () => ({
  prisma: {
    location: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    chlorophyllData: {
      create:    (...args: unknown[]) => mockChlorophyllCreate(...args),
      findFirst: (...args: unknown[]) => mockChlorophyllFindFirst(...args),
    },
    $disconnect: () => mockDisconnect(),
  },
}));

// Import AFTER mocks are set up
import { fetchWithFallbackChain } from '../fetchers/fetch-satellite';

// ── ERDDAP response builder ───────────────────────────────────────────────────

function makeErddapResponse(chl: number | null): object {
  if (chl === null) {
    return { data: { table: { columnNames: ['time', 'chlorophyll'], rows: [] } } };
  }
  return {
    data: {
      table: {
        columnNames: ['time', 'chlorophyll'],
        rows: [['2026-04-24T00:00:00Z', chl]],
      },
    },
  };
}

const LAT     = 32.8506;
const LON     = -117.2727;
const LOC_ID  = 'loc-test-la-jolla-cove';

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockChlorophyllFindFirst.mockResolvedValue(null);
});

describe('fetchWithFallbackChain — fallback chain', () => {
  it('A: primary source succeeds → stale=false, source=noaa-coastwatch', async () => {
    axiosMock.get = jest.fn().mockResolvedValue(makeErddapResponse(0.45));

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(false);
    expect(result.source).toBe('noaa-coastwatch');
    expect(result.data?.valueMgM3).toBe(0.45);
  });

  it('B: primary fails (throws), secondary succeeds → stale=false, source=noaa-westcoast', async () => {
    axiosMock.get = jest.fn()
      .mockRejectedValueOnce(new Error('CoastWatch timeout'))
      .mockResolvedValueOnce(makeErddapResponse(0.72));

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(false);
    expect(result.source).toBe('noaa-westcoast');
    expect(result.data?.valueMgM3).toBe(0.72);
  });

  it('B-alt: primary returns empty rows (null chl), secondary succeeds', async () => {
    axiosMock.get = jest.fn()
      .mockResolvedValueOnce(makeErddapResponse(null))   // source 1 — no data
      .mockResolvedValueOnce(makeErddapResponse(1.1));   // source 2 — success

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(false);
    expect(result.source).toBe('noaa-westcoast');
    expect(result.data?.valueMgM3).toBe(1.1);
  });

  it('C: all sources fail, prior DB row exists → stale=true, source=cached, prior value used', async () => {
    axiosMock.get = jest.fn().mockRejectedValue(new Error('network error'));
    mockChlorophyllFindFirst.mockResolvedValue({
      id:         'prior-row-1',
      locationId: LOC_ID,
      valueMgM3:  1.23,
      fetchedAt:  new Date('2026-04-24T12:00:00Z'),
      source:     'noaa-coastwatch',
      stale:      false,
      raw:        null,
      createdAt:  new Date(),
    });

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(true);
    expect(result.source).toBe('cached');
    expect(result.data?.valueMgM3).toBe(1.23);
  });

  it('D: all sources fail, no prior row → stale=true, source=unavailable, valueMgM3=null', async () => {
    axiosMock.get = jest.fn().mockRejectedValue(new Error('network error'));
    mockChlorophyllFindFirst.mockResolvedValue(null);

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(true);
    expect(result.source).toBe('unavailable');
    expect(result.data?.valueMgM3).toBeNull();
  });

  it('result always has a fetchedAt Date', async () => {
    axiosMock.get = jest.fn().mockResolvedValue(makeErddapResponse(0.3));

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('rounds chlorophyll to 2 decimal places', async () => {
    axiosMock.get = jest.fn().mockResolvedValue({
      data: {
        table: {
          columnNames: ['time', 'chlorophyll'],
          rows: [['2026-04-24T00:00:00Z', 0.4567890]],
        },
      },
    });

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.data?.valueMgM3).toBe(0.46);
  });
});
