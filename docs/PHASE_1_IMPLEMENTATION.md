# Phase 1 implementation notes

## Scope

This phase establishes the application shell and shared data model. The dashboard reads counts and upcoming appointments from Prisma at request time, so it is not a disconnected mock screen.

## Authorization boundary

The current demo session is selected only from the fixed fictional identities in `lib/auth.ts` and stored in an HTTP-only cookie. The user and practice are resolved server-side before dashboard data is queried. Production authentication must replace this demo mechanism with a real identity provider and signed session validation before any PHI use.

## Data boundary

Prisma targets PostgreSQL. Use `DATABASE_URL` for pooled runtime traffic and `DIRECT_URL` for migrations, consistent with Neon serverless deployment guidance. The seed script is deliberately fictional and idempotent for the core records.

## Next phase

Add protected patient registration and provider administration routes with server validation, mutation audit events, integration tests against PostgreSQL, and Playwright coverage for the receptionist workflow.
