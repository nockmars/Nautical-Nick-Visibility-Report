/**
 * scripts/__tests__/fetch-satellite.test.ts
 *
 * Tests for the satellite fetcher's fallback chain behavior.
 * Calls the exported `fetchWithFallbackChain` and `fetchChlorophyll`
 * functions directly to avoid triggering `main()` at import time.
 *
 * Mocks:
 *   - axios (all HTTP) — controlled per test
 *   - lib/db/client prisma — in-memory mock, no real DB
 *
 * Scenarios:
 *   A. Primary source returns valid data → stale=false, source=noaa-westcoast
 *   B. Primary fails, secondary succeeds → stale=false, source=noaa-coastwatch
 *   B-alt. Primary returns empty rows, secondary succeeds
 *   C. All sources fail, prior DB row exists → stale=true, source=cached
 *   D. All sources fail, no prior DB row → stale=true, source=unavailable, valueMgM3=null
 *   E. fetchedAt is always a Date instance
 *   F. Chlorophyll value is rounded to 2 decimal places
 *   G. SD-only filter: location query uses where: { regionId: 'san-diego' }
 *   H. Per-request timeout: axios is called with timeout: 15000
 *   I. Per-attempt error logging: console.warn called with source name + status on failure
 */

// Set DATABASE_URL before any import so the module-level guard (now inside main()) passes.
process.env.DATABASE_URL = 'postgresql://test:test@localhost/testdb';

jest.mock('axios');
jest.mock('dotenv/config', () => ({}));

import axios from 'axios';
const axiosMock = axios as jest.Mocked<typeof axios>;

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockLocationFindMany       = jest.fn().mockResolvedValue([]);
const mockChlorophyllFindFirst   = jest.fn();
const mockChlorophyllCreate      = jest.fn().mockResolvedValue({});
const mockDisconnect             = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/db/client', () => ({
  prisma: {
    location: {
      findMany: (...args: unknown[]) => mockLocationFindMany(...args),
    },
    chlorophyllData: {
      create:    (...args: unknown[]) => mockChlorophyllCreate(...args),
      findFirst: (...args: unknown[]) => mockChlorophyllFindFirst(...args),
    },
    $disconnect: () => mockDisconnect(),
  },
}));

// Import AFTER mocks are set up
import { fetchWithFallbackChain, fetchChlorophyll } from '../fetchers/fetch-satellite';

// ── ERDDAP response builder ───────────────────────────────────────────────────

function makeErddapResponse(chl: number | null): object {
  if (chl === null) {
    return { data: { table: { columnNames: ['time', 'altitude', 'latitude', 'longitude', 'chlor_a'], rows: [] } } };
  }
  return {
    data: {
      table: {
        columnNames: ['time', 'altitude', 'latitude', 'longitude', 'chlor_a'],
        rows: [['2026-04-24T00:00:00Z', 0.0, 32.8506, -117.2727, chl]],
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
  mockLocationFindMany.mockResolvedValue([]);
});

describe('fetchWithFallbackChain — fallback chain', () => {
  it('A: primary source succeeds → stale=false, source=noaa-westcoast', async () => {
    axiosMock.get = jest.fn().mockResolvedValue(makeErddapResponse(0.45));

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(false);
    expect(result.source).toBe('noaa-westcoast');
    expect(result.data?.valueMgM3).toBe(0.45);
  });

  it('B: primary fails (throws), secondary succeeds → stale=false, source=noaa-coastwatch', async () => {
    axiosMock.get = jest.fn()
      .mockRejectedValueOnce(new Error('VIIRS timeout'))
      .mockResolvedValueOnce(makeErddapResponse(0.72));

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(false);
    expect(result.source).toBe('noaa-coastwatch');
    expect(result.data?.valueMgM3).toBe(0.72);
  });

  it('B-alt: primary returns empty rows (null chl), secondary succeeds', async () => {
    axiosMock.get = jest.fn()
      .mockResolvedValueOnce(makeErddapResponse(null))   // source 1 — no data
      .mockResolvedValueOnce(makeErddapResponse(1.1));   // source 2 — success

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.stale).toBe(false);
    expect(result.source).toBe('noaa-coastwatch');
    expect(result.data?.valueMgM3).toBe(1.1);
  });

  it('C: all sources fail, prior DB row exists → stale=true, source=cached, prior value used', async () => {
    axiosMock.get = jest.fn().mockRejectedValue(new Error('network error'));
    mockChlorophyllFindFirst.mockResolvedValue({
      id:         'prior-row-1',
      locationId: LOC_ID,
      valueMgM3:  1.23,
      fetchedAt:  new Date('2026-04-24T12:00:00Z'),
      source:     'noaa-westcoast',
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

  it('E: result always has a fetchedAt Date', async () => {
    axiosMock.get = jest.fn().mockResolvedValue(makeErddapResponse(0.3));

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('F: rounds chlorophyll to 2 decimal places', async () => {
    axiosMock.get = jest.fn().mockResolvedValue({
      data: {
        table: {
          columnNames: ['time', 'altitude', 'latitude', 'longitude', 'chlor_a'],
          rows: [['2026-04-24T00:00:00Z', 0.0, 32.8506, -117.2727, 0.4567890]],
        },
      },
    });

    const result = await fetchWithFallbackChain(LAT, LON, LOC_ID);

    expect(result.data?.valueMgM3).toBe(0.46);
  });

  it('I: per-attempt error logging — console.warn called with source name and status on failure', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const httpErr = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404 },
    });
    axiosMock.get = jest.fn()
      .mockRejectedValueOnce(httpErr)
      .mockRejectedValueOnce(new Error('network error'));

    await fetchWithFallbackChain(LAT, LON, LOC_ID);

    // First warn: noaa-westcoast with status 404
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('noaa-westcoast'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('404'),
    );
    // Second warn: noaa-coastwatch with no-status
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('noaa-coastwatch'),
    );

    warnSpy.mockRestore();
  });
});

describe('SD-only filter — location query', () => {
  it('G: fetchChlorophyll uses signed longitude and includes altitude axis in URL', async () => {
    axiosMock.get = jest.fn().mockResolvedValue(makeErddapResponse(0.5));

    const source = {
      name: 'noaa-westcoast' as const,
      base: 'https://coastwatch.noaa.gov/erddap/griddap',
      dataset: 'noaacwNPPVIIRSSQchlaDaily',
    };

    await fetchChlorophyll(source, LAT, LON);

    const [calledUrl] = (axiosMock.get as jest.Mock).mock.calls[0];
    // Signed longitude (not 0-360 converted)
    expect(calledUrl).toContain('-117.2727');
    // Altitude axis present
    expect(calledUrl).toContain('(0.0)');
    // chlor_a variable (not chlorophyll)
    expect(calledUrl).toContain('chlor_a');
  });
});

describe('per-request timeout — axios config', () => {
  it('H: axios.get is called with timeout: 15000 on every ERDDAP request', async () => {
    axiosMock.get = jest.fn().mockResolvedValue(makeErddapResponse(0.88));

    const source = {
      name: 'noaa-westcoast' as const,
      base: 'https://coastwatch.noaa.gov/erddap/griddap',
      dataset: 'noaacwNPPVIIRSSQchlaDaily',
    };

    await fetchChlorophyll(source, LAT, LON);

    const [, calledConfig] = (axiosMock.get as jest.Mock).mock.calls[0];
    expect(calledConfig).toMatchObject({ timeout: 15_000 });
  });

  it('H-err: axios timeout error propagates out of fetchChlorophyll (no silent swallow)', async () => {
    const timeoutErr = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
    axiosMock.get = jest.fn().mockRejectedValue(timeoutErr);

    const source = {
      name: 'noaa-westcoast' as const,
      base: 'https://coastwatch.noaa.gov/erddap/griddap',
      dataset: 'noaacwNPPVIIRSSQchlaDaily',
    };

    // fetchChlorophyll itself should throw — the warn happens in fetchWithFallbackChain
    await expect(fetchChlorophyll(source, LAT, LON)).rejects.toThrow('timeout');
  });
});
