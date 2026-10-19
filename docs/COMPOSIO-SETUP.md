# Composio setup

Concord reads one selected synthetic workload manifest per owner through Composio. Signing in to Composio or installing a consumer client does not authorize the developer project's backend. Consumer connections and Platform project connections are separate.

## Configure the project

1. Create or select a Platform project. Save its API key directly into the ignored `.env` as `COMPOSIO_API_KEY`.
2. Use only the permissions required by the SDK session path: Session management read/write, Session tool execution write, Tools/Toolkits/Auth configs read. Connected accounts read/write is needed only when creating owner connection links. No triggers, webhooks, raw proxy or legacy execution are used.
3. Create a Google Sheets auth config in that same project. Narrow its provider scopes to `spreadsheets.readonly` and `userinfo.email`. Save its ID as `COMPOSIO_GOOGLESHEETS_AUTH_CONFIG_ID`.
4. Create an owner connection using `composio.connectedAccounts.link(stableOwnerId, authConfigId)`. Let the owner complete Google authorization using a demo-only account. The dashboard's Playground connection is not an application owner connection.
5. Verify that the selected connected account is `ACTIVE`. A generated link or an `INITIATED` connection is not a completed grant. Reuse a pending flow when possible instead of creating duplicate connections.

A project API permission to execute tools differs from the Google provider grant. The backend permits only `GOOGLESHEETS_BATCH_GET`; this does not narrow an overly broad OAuth grant. The Google read scope covers spreadsheets across the authorized account, so use an account without private data.

## Select synthetic data

Create a tab named `Workload` with exactly these key/value rows in `A1:B4`:

| A              | B           |
| -------------- | ----------- |
| gpuCount       | 1           |
| minVramGb      | 24          |
| runtimeMinutes | 60          |
| trustClass     | public-demo |

Bob's default runtime is 120 minutes. Configure each owner's stable user ID, connected-account ID and spreadsheet ID using the names in `.env.example`. Keep the two owner mappings separate. Do not use personal production sheets or upload code, datasets or assistant memory.

The adapter pins the auth config and connected account, disables connection management, sandbox tools and Instant, and reads only the selected range. Strict parsing checks spreadsheet identity, four exact field names, numeric limits and `public-demo`. Other instructions in a sheet are untrusted data and are rejected.

## Verify

```sh
ALLOW_LIVE_CALLS=true npm run verify:composio -- alice
```

This performs one real selected-owner read without changing persistent mode settings. The command fails clearly if credentials, selected sheet, connection or supported response are missing. It writes a sanitized report to ignored `.data/`. It does not prove the other owner's connection or Parallel integration.

For the full journey, configure both owners, enable `COMPOSIO_MODE=live` and run the main verification command documented in README. Changing selected manifest requirements causes old proposal approvals to be invalidated on refresh. No external writes or booking action are implemented.

References: [Composio overview](https://docs.composio.dev/docs), [session configuration](https://docs.composio.dev/docs/configuring-sessions), [scope control](https://docs.composio.dev/docs/authentication/controlling-scopes), [owner authentication](https://docs.composio.dev/docs/authentication/manually-authenticating), [consumer/project boundaries](https://docs.composio.dev/kb/guide/consumer-project-boundaries-and-auth-selection).

## If Google blocks the app

Stop the authorization attempt. A valid Composio project key or a generated hosted link does not override Google’s denial and does not prove access to Sheets data. Record the exact provider message without recording tokens or personal account details.

Composio documents that Google can block unverified sensitive scopes and recommends a verified OAuth app for production use. The generic block screen alone does not establish the exact underlying policy reason. Resolving the configuration may require Composio support or an explicitly approved customer-owned Google OAuth client and the required Google verification. Do not weaken account security, broaden scopes, or retry another route to the denied data.

See [Composio’s Google OAuth guidance](https://docs.composio.dev/kb/guide/toolkits-googledocs).
