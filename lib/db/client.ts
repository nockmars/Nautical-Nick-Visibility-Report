/**
 * lib/db/client.ts
 *
 * Prisma client singleton for Next.js.
 *
 * In development, Next.js HMR restarts modules repeatedly which would create
 * too many connections. We attach the client to `globalThis` so it survives
 * module re-evaluation. In production there is only one instance per process.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
