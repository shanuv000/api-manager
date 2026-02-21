const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Create a PostgreSQL connection pool with explicit limits
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,                      // 5 connections is plenty for single-process
  idleTimeoutMillis: 30000,    // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail after 5s instead of hanging forever
});

// Create Prisma adapter
const adapter = new PrismaPg(pool);

// Initialize Prisma Client with adapter
const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

// Export pool for graceful shutdown in server.js
// Note: beforeExit does NOT fire on SIGTERM/SIGINT (PM2 signals)
module.exports = prisma;
module.exports.pool = pool;

