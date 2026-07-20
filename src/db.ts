import { PrismaClient } from '@prisma/client';

// Standard singleton pattern -- avoids exhausting Postgres connections
// when ts-node-dev hot-reloads in development.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV === 'development') {
  global.__prisma = prisma;
}
