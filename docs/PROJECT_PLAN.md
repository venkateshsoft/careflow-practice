# CareFlow Practice — Project Plan

## Phase 1 — Foundation
- [ ] Inspect the repository and agree on the application scaffold
- [ ] Configure Next.js, TypeScript, linting, formatting, and environment validation
- [ ] Configure Prisma and PostgreSQL connection patterns
- [ ] Define practice, user, role, permission, and audit foundations
- [ ] Implement authentication and server-side authorization
- [ ] Add synthetic-only seed data and tests
- [ ] Build authenticated application shell and operational dashboard

## Phase 2 — Practice Management
- [ ] Practice and provider configuration
- [ ] Patient registration, demographics, search, duplicate detection
- [ ] Patient insurance and guarantor records
- [ ] Appointment calendar, booking, rescheduling, cancellation, check-in, no-show

## Phase 3 — Clinical
- [ ] Longitudinal patient chart
- [ ] Problems, medications, allergies, directives, observations
- [ ] Orders, alerts, flags, diagnoses, clinical notes
- [ ] Encounter lifecycle and draft/pending-signature/signed/amended states
- [ ] Immutable signed records and auditable amendments

## Phase 4 — Revenue Cycle
- [ ] CPT/HCPCS fee schedule and procedure catalog
- [ ] Charge capture from supported completed billable services
- [ ] Patient responsibility and statement workflows
- [ ] Payment posting, adjustments, refunds, reconciliation

## Phase 5 — Interoperability
- [ ] X12 837P generation and validation
- [ ] X12 835 ingestion and posting
- [ ] Eligibility and claim status adapters
- [ ] E-prescribing adapter and sandbox workflow
- [ ] FHIR interoperability endpoints as scoped

## Phase 6 — Readiness and deployment
- [ ] Authorization, security, and audit testing
- [ ] Unit, integration, regression, and Playwright E2E suites
- [ ] Backup and restoration validation
- [ ] Deployment to synthetic-data test environment
- [ ] Document integrations requiring external credentials, contracts, or approvals

## Definition of done
A task is complete only when implementation, database persistence, server-side authorization, audit behavior where applicable, automated tests, and user-visible error/success states are in place. External actions must report their actual delivery status; simulated actions must be labelled as simulations.
