# Synthetic Data and Safety Policy

## Non-negotiable environment boundary

All development, preview, staging, demo, and initial deployment environments are synthetic-data environments. Never input, import, upload, email, transmit, or store real patient information or Protected Health Information (PHI).

## Synthetic fixture requirements
- Generate fictional identities and contact information.
- Use reserved example domains and obviously non-routable test phone values.
- Use fictional payer/member identifiers with explicit TEST markers.
- Do not copy real clinical records or screenshots into issues, fixtures, logs, test reports, or documentation.
- Do not use real clinician identifiers or live pharmacy/payer routing details.
- Keep seeds deterministic where practical and label all fixtures as synthetic.

## External services
- Use vendor sandboxes and test credentials only.
- Do not transmit a prescription to a real pharmacy.
- Do not submit a claim to a real payer or clearinghouse production endpoint.
- Do not charge real payment instruments.
- Display clear simulated/sandbox status in the UI and audit records.
- Never claim a message, prescription, claim, or payment was externally delivered unless the provider has confirmed it.

## Security engineering requirements
- Enforce authorization in server-side code, not only in the UI.
- Validate and normalize all untrusted input.
- Avoid logging patient details, tokens, credentials, or full payloads.
- Keep secrets out of source control and browser bundles.
- Use least-privilege database and service credentials.
- Maintain security-relevant audit events.
- Preserve signed clinical content and financial transaction history with amendment/reversal patterns.

## Production gate

No live PHI processing until the organization has independently completed and documented applicable HIPAA risk analysis and safeguards, BAAs with relevant vendors, secure production environment controls, incident response, access review, backup/recovery validation, external e-prescribing and clearinghouse enrollment/agreements, and clinical/financial workflow validation. Technical implementation alone is not a HIPAA compliance certification.
