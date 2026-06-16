import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client singleton. The keeper is the sole writer of Streak,
 * AgentAction, Redemption, and tournament settlement (docs/05) — other services
 * read/upsert their own rows (User, sessions live in Redis).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
