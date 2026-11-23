# Architecture Decision Record — Initial Direction

## Application shape
Start with a modular monolith. A single deployable Next.js application with clearly separated domain modules is appropriate for the initial single-clinic, 1–2 physician scope. Avoid premature microservices.

## Proposed stack
- Next.js App Router, React, TypeScript
- Tailwind CSS and accessible component primitives
- PostgreSQL with Prisma
- Server-side services and route handlers
- Vercel hosting
- GitHub Actions for CI
- Playwright for end-to-end tests

Before implementation, verify current supported versions and deployment compatibility. Keep the database provider and hosting configuration environment-driven.

## Domain boundaries
- Identity and access
- Practice and provider administration
- Patient identity and demographics
- Scheduling
- Clinical chart and encounters
- Orders and prescriptions
- Charge capture and fee schedules
- Billing and statements
- Claims and remittance
- Documents
- Audit and reporting
- External integration adapters

## Persistence rules
- Every domain write must be persisted through server-side code.
- Use database transactions for multi-record clinical/financial state changes.
- Use foreign keys and unique constraints for integrity.
- Use soft deletion only where appropriate; never silently erase signed clinical records, audit events, or posted financial transactions.
- Use explicit amendments, reversals, and status transitions with attribution.
- Use UTC timestamps with clinic-local time-zone handling for scheduling.

## Integration boundary
All e-prescribing, clearinghouse, eligibility, payment, laboratory, and FHIR external calls must be isolated behind adapters. Each adapter must support a disabled or sandbox mode, configuration validation, structured status/error reporting, and safe retry/idempotency behavior.

## Security
Authentication and server-side RBAC are mandatory before protected clinical or financial routes are exposed. Use secure cookies, CSRF protections appropriate to the chosen auth pattern, rate limiting, input validation, secret management, audit trails, and restricted document access.

## Outstanding decisions
- Select and verify authentication provider/library.
- Select PHI-suitable database, file storage, email, SMS, analytics, logging, and monitoring vendors before any live PHI deployment.
- Confirm hosting and vendor BAA availability and contract scope.
- Confirm operational recovery objectives and retention requirements with the clinic.
