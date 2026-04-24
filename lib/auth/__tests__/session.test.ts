/**
 * Tests for lib/auth/session.ts
 *
 * Verifies session create/get/destroy lifecycle and expiry handling.
 * Uses Jest mocks for Prisma to avoid real DB calls.
 */

// Mock prisma before importing session module
const mockSessionCreate = jest.fn();
const mockSessionFindUnique = jest.fn();
const mockSessionDelete = jest.fn();
const mockSessionDeleteMany = jest.fn();

jest.mock('@/lib/db/client', () => ({
  prisma: {
    session: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      delete: mockSessionDelete,
      deleteMany: mockSessionDeleteMany,
    },
  },
}));

import { createSession, getSession, destroySession, destroyAllSessionsForUser } from '../session';

const MOCK_USER = {
  id: 'user-1',
  email: 'test@example.com',
  username: null,
  passwordHash: 'hash',
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createSession', () => {
  it('calls prisma.session.create and returns a token string', async () => {
    mockSessionCreate.mockResolvedValueOnce({});

    const token = await createSession('user-1', { userAgent: 'test-agent', ip: '127.0.0.1' });

    expect(typeof token).toBe('string');
    expect(token.length).toBe(128); // 64 bytes = 128 hex chars
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          userAgent: 'test-agent',
          ip: '127.0.0.1',
        }),
      }),
    );
  });

  it('sets expires_at approximately 60 days from now', async () => {
    mockSessionCreate.mockResolvedValueOnce({});

    await createSession('user-1');

    const callArg = mockSessionCreate.mock.calls[0][0];
    const expiresAt: Date = callArg.data.expiresAt;
    const expectedMs = 60 * 24 * 60 * 60 * 1000;
    const diff = expiresAt.getTime() - Date.now();

    // Within 5 seconds of 60 days
    expect(diff).toBeGreaterThan(expectedMs - 5000);
    expect(diff).toBeLessThanOrEqual(expectedMs + 5000);
  });

  it('generates a different token each call', async () => {
    mockSessionCreate.mockResolvedValue({});

    const token1 = await createSession('user-1');
    const token2 = await createSession('user-1');

    expect(token1).not.toBe(token2);
  });
});

describe('getSession', () => {
  it('returns session with user when token is valid and not expired', async () => {
    const futureDate = new Date(Date.now() + 1_000_000);
    const mockSession = {
      id: 'sess-1',
      token: 'valid-token',
      userId: 'user-1',
      expiresAt: futureDate,
      createdAt: new Date(),
      userAgent: null,
      ip: null,
      user: MOCK_USER,
    };

    mockSessionFindUnique.mockResolvedValueOnce(mockSession);

    const result = await getSession('valid-token');

    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-1');
    expect(result?.user.email).toBe('test@example.com');
  });

  it('returns null when token is not found', async () => {
    mockSessionFindUnique.mockResolvedValueOnce(null);

    const result = await getSession('nonexistent-token');

    expect(result).toBeNull();
  });

  it('returns null and triggers delete when session is expired', async () => {
    const pastDate = new Date(Date.now() - 1000);
    mockSessionFindUnique.mockResolvedValueOnce({
      id: 'sess-expired',
      token: 'expired-token',
      userId: 'user-1',
      expiresAt: pastDate,
      createdAt: new Date(),
      user: MOCK_USER,
    });
    // delete is fire-and-forget; mock it to resolve
    mockSessionDelete.mockResolvedValueOnce({});

    const result = await getSession('expired-token');

    expect(result).toBeNull();
    // Expired session should have been deleted (eventually)
    // Allow microtask queue to settle
    await new Promise(resolve => setImmediate(resolve));
    expect(mockSessionDelete).toHaveBeenCalledWith({
      where: { token: 'expired-token' },
    });
  });
});

describe('destroySession', () => {
  it('calls prisma.session.delete with the token', async () => {
    mockSessionDelete.mockResolvedValueOnce({});

    await destroySession('some-token');

    expect(mockSessionDelete).toHaveBeenCalledWith({
      where: { token: 'some-token' },
    });
  });

  it('does not throw when token does not exist', async () => {
    mockSessionDelete.mockRejectedValueOnce(new Error('Record not found'));

    await expect(destroySession('ghost-token')).resolves.not.toThrow();
  });
});

describe('destroyAllSessionsForUser', () => {
  it('calls prisma.session.deleteMany with userId', async () => {
    mockSessionDeleteMany.mockResolvedValueOnce({ count: 3 });

    await destroyAllSessionsForUser('user-1');

    expect(mockSessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });
});
