# CareFlow Practice

Cloud-based ambulatory Practice Management and EMR/EHR application for independent US outpatient clinics.

> **Development safety boundary:** This repository and all deployed development environments are for synthetic-data testing only. Do not enter, upload, transmit, or store real patient information or Protected Health Information (PHI).

## Project status

Initial repository foundation. Implementation will proceed in verified phases. A module is not considered complete until its persistent database behavior, authorization, audit requirements, and automated tests are implemented and verified.

## Initial target

- One outpatient clinic
- 1–2 physicians, with receptionist, clinical staff, billing, and administrator roles
- Global web access through authenticated HTTPS
- Persistent relational storage
- End-to-end scheduling, clinical documentation, billing, and claims test workflows

## Planned architecture

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS
- **Backend:** Next.js server-side services / API routes with runtime validation
- **Database:** PostgreSQL with Prisma ORM and migrations
- **Hosting:** Vercel
- **Source control and CI:** GitHub
- **Testing:** unit, API/integration, and Playwright end-to-end tests
- **External integrations:** isolated adapters for e-prescribing, clearinghouse, payment, FHIR, and other services

Technology versions and provider suitability must be verified at implementation time. Do not commit secrets or credentials.

## Planned functional areas

1. Authentication, practice configuration, roles, and permissions
2. Patient registration and demographics
3. Provider schedules and appointments
4. Longitudinal patient chart and encounter documentation
5. Problems, medications, allergies, directives, observations, orders, alerts, and flags
6. Clinical note review, signature, amendment, and audit history
7. Procedure catalog and charge capture
8. Patient billing, payments, receipts, and statements
9. Insurance eligibility, claims, acknowledgments, and remittance workflows
10. Reporting, document management, and interoperability

## Synthetic-data-only requirements

- Use generated, clearly fictional patient and provider records only.
- Do not use real names, dates of birth, addresses, phone numbers, member IDs, NPIs belonging to real clinicians, or actual clinical records in seed data.
- Use sandbox/test credentials for external integrations.
- Do not send prescriptions to real pharmacies or submit claims to real payers from development.
- Keep test and production environments, databases, credentials, and storage fully separated.
- Add automated tests that reject production-like secrets and prevent accidental PHI fixtures.
- Do not describe the application as HIPAA compliant or production-ready merely because technical controls exist.

## Production-readiness gate

Live PHI use is prohibited until all applicable safeguards and operational requirements have been independently validated, including:

- HIPAA Security and Privacy Rule risk analysis and required safeguards
- Business Associate Agreements with applicable vendors
- Secure production infrastructure, access controls, audit, monitoring, backup, and recovery
- E-prescribing network enrollment and required approvals
- Clearinghouse agreements, connectivity, and payer-specific validation
- Clinical, billing, security, incident-response, and operational validation

## Development principles

- Use database-backed workflows; do not substitute frontend-only state for persistence.
- Enforce authorization on the server for every protected operation.
- Preserve signed clinical records; corrections must use auditable amendment workflows.
- Preserve financial transaction history; use reversals/adjustments rather than destructive deletion.
- Validate inputs at trust boundaries and use database transactions for critical operations.
- Keep external services behind explicit adapters with sandbox mode and observable delivery status.
- Document limitations where external credentials, contracts, or approvals are unavailable.

## Repository layout (planned)

```text
app/                 Next.js routes and screens
components/          Shared UI components
lib/                 Server services, validation, auth, database, integrations
prisma/              Prisma schema, migrations, synthetic seed data
tests/               Unit, integration, and end-to-end tests
docs/                Architecture, workflows, security, and operational docs
```

## Getting started

Implementation instructions will be added with the first application scaffold. Never place real credentials in source control. Use local environment files excluded by Git and configure deployment secrets through the hosting provider.

## Disclaimer

CareFlow Practice is a software development project. This repository does not provide medical, legal, coding, billing, or compliance advice. It is not currently approved for live clinical use or PHI processing.
