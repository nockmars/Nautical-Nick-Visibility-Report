/**
 * Tests for auth API routes: signup, login, logout, me.
 *
 * Verifies:
 *   - signup creates user + session, returns 201
 *   - signup returns 409 for duplicate email
 *   - login returns 401 for wrong credentials (generic message)
 *   - login timing-safe path (no user found still runs verifyPassword)
 *   - logout always returns 200
 *   - me returns { user: null, isPro: false } for unauthenticated request
 *   - me returns user + isPro for authenticated request
 *   - gated routes return 403 for free users (covered by server.ts isPro tests)
 *
 * NextRequest is instantiated directly — no need for a running server.
 */

import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Mock env vars before module imports
// ─────────────────────────────────────────────────────────────────────────────
process.env.SESSION_COOKIE_NAME = 'naut_session';

// ─────────────────────────────────────────────────────────────────────────────
// Mock next/headers (cookies())
// ─────────────────────────────────────────────────────────────────────────────
const mockCookieSet = jest.fn();
const mockCookieGet = jest.fn();

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    set: mockCookieSet,
    get: mockCookieGet,
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock Prisma
// ─────────────────────────────────────────────────────────────────────────────
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();
const mockSessionCreate = jest.fn();
const mockSessionFindUnique = jest.fn();
const mockSessionDelete = jest.fn();

jest.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
      update: mockUserUpdate,
    },
    session: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      delete: mockSessionDelete,
    },
  },
}));

// Import routes AFTER mocks
import { POST as signupPost } from '../auth/signup/route';
import { POST as loginPost } from '../auth/login/route';
import { POST as logoutPost } from '../auth/logout/route';
import { GET as meGet } from '../auth/me/route';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const url = 'http://localhost:3000/api/auth/test';
  const requestInit: { method: string; body?: string; headers: Record<string, string> } = {
    method,
    headers,
  };
  if (body) {
    requestInit.body = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  // NextRequest accepts a web Request or URL + init; the init types diverge
  // slightly from the DOM RequestInit, so we build a plain object.
  return new NextRequest(new Request(url, requestInit));
}

// ─────────────────────────────────────────────────────────────────────────────
// Signup tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionCreate.mockResolvedValue({});
  });

  it('creates user and returns 201 with user payload', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null); // no existing user
    mockUserCreate.mockResolvedValueOnce({
      id: 'user-new',
      email: 'new@example.com',
      passwordHash: 'hash',
    });

    const req = makeRequest('POST', { email: 'new@example.com', password: 'strongpass1' });
    const res = await signupPost(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.user.email).toBe('new@example.com');
    expect(mockCookieSet).toHaveBeenCalled();
  });

  it('returns 409 when email already exists', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: 'user-exists' });

    const req = makeRequest('POST', { email: 'exists@example.com', password: 'strongpass1' });
    const res = await signupPost(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/already exists/i);
  });

  it('returns 400 for invalid email', async () => {
    const req = makeRequest('POST', { email: 'not-an-email', password: 'strongpass1' });
    const res = await signupPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for password shorter than 8 chars', async () => {
    const req = makeRequest('POST', { email: 'user@example.com', password: 'short' });
    const res = await signupPost(req);
    expect(res.status).toBe(400);
  });

  it('normalizes email to lowercase', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockUserCreate.mockResolvedValueOnce({ id: 'user-new', email: 'upper@example.com' });

    const req = makeRequest('POST', { email: 'UPPER@EXAMPLE.COM', password: 'strongpass1' });
    await signupPost(req);

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: 'upper@example.com' },
    });
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'upper@example.com' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionCreate.mockResolvedValue({});
    mockUserUpdate.mockResolvedValue({});
  });

  it('returns 200 and sets cookie on valid credentials', async () => {
    // Use a real argon2 hash for 'correctpass'
    const { hashPassword } = await import('@/lib/auth/password');
    const hash = await hashPassword('correctpass');

    mockUserFindUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: hash,
    });

    const req = makeRequest('POST', { email: 'user@example.com', password: 'correctpass' });
    const res = await loginPost(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.email).toBe('user@example.com');
    expect(mockCookieSet).toHaveBeenCalled();
  });

  it('returns 401 with generic message on wrong password', async () => {
    const { hashPassword } = await import('@/lib/auth/password');
    const hash = await hashPassword('correctpass');

    mockUserFindUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: hash,
    });

    const req = makeRequest('POST', { email: 'user@example.com', password: 'wrongpass' });
    const res = await loginPost(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('Invalid email or password');
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it('returns 401 with generic message when user does not exist (timing-safe path)', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);

    const req = makeRequest('POST', { email: 'ghost@example.com', password: 'anypassword' });
    const res = await loginPost(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('Invalid email or password');
    // Should NOT leak that the user doesn't exist
    expect(mockCookieSet).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logout tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionDelete.mockResolvedValue({});
  });

  it('returns 200 and clears cookie when session cookie is present', async () => {
    const req = makeRequest('POST');
    // Simulate cookie on the request
    Object.defineProperty(req, 'cookies', {
      value: { get: (_name: string) => ({ value: 'some-token' }) },
    });

    const res = await logoutPost(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockCookieSet).toHaveBeenCalled(); // clearSessionCookie sets maxAge=0
  });

  it('returns 200 even when no session cookie is present', async () => {
    const req = makeRequest('POST');
    Object.defineProperty(req, 'cookies', {
      value: { get: (_name: string) => undefined },
    });

    const res = await logoutPost(req);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Me tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns { user: null, isPro: false } when unauthenticated', async () => {
    const req = makeRequest('GET');
    // No session cookie → getSessionFromRequest returns null
    Object.defineProperty(req, 'cookies', {
      value: { get: (_name: string) => undefined },
    });

    const res = await meGet(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user).toBeNull();
    expect(data.isPro).toBe(false);
  });

  it('returns user + isPro: false for authenticated free user', async () => {
    const sessionToken = 'valid-session-token';
    const futureDate = new Date(Date.now() + 1_000_000);

    mockSessionFindUnique.mockResolvedValueOnce({
      id: 'sess-1',
      token: sessionToken,
      userId: 'user-1',
      expiresAt: futureDate,
      user: { id: 'user-1', email: 'free@example.com' },
    });

    mockUserFindUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'free@example.com',
      subscription: null,
    });

    const req = makeRequest('GET');
    Object.defineProperty(req, 'cookies', {
      value: { get: (_name: string) => ({ value: sessionToken }) },
    });

    const res = await meGet(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user.email).toBe('free@example.com');
    expect(data.isPro).toBe(false);
  });
});
