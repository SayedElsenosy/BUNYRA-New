import { neon } from '@neondatabase/serverless';

// Server-only connection. Never import this module from a client component.
export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
}
