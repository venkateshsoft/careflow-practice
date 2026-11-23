# CareFlow Practice

CareFlow Practice is a Next.js + Prisma foundation for a US ambulatory practice management and EMR/EHR demonstration. It is synthetic-data-only and is not approved for live clinical use. It does not claim HIPAA compliance.

## Phase 1 delivered

- Next.js App Router, React, TypeScript, Tailwind CSS
- PostgreSQL/Prisma relational foundation for practices, users, providers, patients, appointments, and audit events
- Server-side demo session and role-aware identity context
- Synthetic seed records and a database-backed dashboard
- Public DEMO / SYNTHETIC DATA ENVIRONMENT indicator
- Vitest safety-boundary test

## Local setup

1. Copy `.env.example` to `.env` and provide pooled `DATABASE_URL`, direct `DIRECT_URL`, and a long random `AUTH_SECRET`.
2. Install dependencies with `npm install`.
3. Apply migrations with `npm run db:migrate`.
4. Seed fictional records with `npm run db:seed`.
5. Run `npm run dev` and open `http://localhost:3000`.

The demo login presents three fictional identities: administrator, physician, and receptionist. The seed data uses made-up names, phone numbers, and identifiers.

## Verification

`npm run build` and `npm test` are the Phase 1 checks. Database-backed pages require a configured PostgreSQL connection and seeded schema.

## Safety boundary

Do not enter PHI, real patient data, live prescription information, payer credentials, or production secrets. External integration adapters, claims, e-prescribing, payment processing, and clinical workflows are planned for later phases and must remain sandbox-only.
