# Management Demonstration Guide

## Purpose
CareFlow Practice is being developed as a publicly shareable management demonstration of outpatient practice workflows, user experience, and product direction. The public GitHub repository and deployed demo are intended for review and feedback.

## Demo safety boundary
This is a synthetic-data demonstration environment only. Never enter real patient information, PHI, real insurance member identifiers, actual prescriptions, live payment details, or confidential clinic information.

## What management can review
- Navigation and overall user experience
- Patient registration and demographic workflow using fictional records
- Appointment scheduling and check-in
- Patient chart and encounter documentation
- Draft, sign, and amendment workflow demonstrations
- Charge capture and patient billing
- Synthetic claim generation and validation
- Simulated prescription and external integration statuses
- Reporting and dashboard experience

## Clearly label simulated actions
The UI must visibly identify sandbox/demo mode. A generated claim file is not a submitted claim. A prescription record is not a transmitted prescription. A simulated payment is not a settled payment. Never imply an external service completed an action without a confirmed response from that service.

## Feedback
Management feedback should be captured as GitHub Issues with:
- Screen or module
- Expected behavior
- Actual behavior
- Priority
- Reproduction steps
- Screenshot with synthetic data only

Do not include patient information, credentials, access tokens, or other secrets in issues.

## Public repository hygiene
Because this repository is public:
- Never commit secrets, environment files, credentials, API keys, or database connection strings.
- Keep real patient data and confidential business information out of source control.
- Review changes and automated secret scanning before merging.
- Use synthetic fixtures only.
- Treat demo accounts and demo data as publicly viewable.
