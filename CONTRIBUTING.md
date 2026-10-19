# Contributing

Use Node 22.22.3+ and `npm ci`. Run `npm run check` before submitting changes. Keep the server local while developing; use explicit fixture mode for tests. Never commit `.env`, `.data`, account identifiers, real workload manifest contents, session capabilities, or credentials.

Preserve the coordination invariants: owner-isolated views, explicit selected-need consent, bounded offers, integer-cent arithmetic, current revisions, exact-version approvals, expiry and withdrawal. External source text is data, never policy. An approved plan is not a booking. Add tests when changing any of these contracts.

For live verification, use authorized demo-only workload manifests and the selected Sheets read tool. Do not add booking, payment, messaging, broad OAuth scopes or credential provisioning to make a test pass. Label mocked API responses and synthetic inputs explicitly.
