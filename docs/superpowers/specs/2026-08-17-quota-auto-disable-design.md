# Quota Tracker Auto-Disable Design

## Goal

Automatically disable provider connections whose primary quota is depleted, then automatically re-enable only those connections when the quota recovers.

Manual account state must be preserved: an account disabled by the user must not be re-enabled by quota polling.

## Current Context

Quota Tracker fetches usage through `GET /api/usage/:connectionId`. The endpoint refreshes OAuth credentials when needed, calls the provider usage service, and returns normalized provider-specific usage data. Provider connections already support `isActive` updates through `PUT /api/providers/:id`, and provider-specific metadata is stored as JSON.

The normalized quota list is ordered by the provider/model registry. The first quota entry is therefore treated as the primary quota for this feature.

## Behavior

### Depleted detection

Only a successful response containing a valid primary quota may change connection state.

An account is depleted when the primary quota has one of these representations:

- `remaining <= 5` for percentage-based normalized quotas.
- `remainingPercentage <= 5` for percentage-based raw quota data.
- When no remaining value exists, `used >= total` for finite totals.

The existing `DEPLETED_QUOTA_THRESHOLD` value (`5`) is reused. A missing quota, empty quota list, provider message, HTTP error, timeout, refresh failure, or malformed usage response does not change `isActive`.

### Automatic disable

When an active account becomes depleted:

- Set `isActive` to `false`.
- Store `providerSpecificData.quotaAutoDisabled` as `true`.
- Store diagnostic metadata such as the detection timestamp and primary quota name/value.

The update must merge into existing `providerSpecificData` without removing proxy, workspace, auth, or provider-specific fields.

### Automatic re-enable

When a quota response is healthy and the primary quota is above the depletion threshold:

- Re-enable the connection only when `providerSpecificData.quotaAutoDisabled === true`.
- Remove the quota auto-disable marker and its diagnostic metadata.

Connections without the marker remain disabled, preserving manual user intent.

### Manual state changes

When `PUT /api/providers/:id` receives an explicit `isActive` update from the user, it clears the quota auto-disable marker. This prevents a later quota poll from interpreting a manual disable as an automatic disable.

The internal quota state transition bypasses the HTTP route and updates the connection repository directly, so it can set or clear the marker atomically with `isActive`.

## Architecture and Data Flow

1. Quota Tracker requests `/api/usage/:connectionId`.
2. The endpoint refreshes credentials and calls the provider usage API.
3. After a successful usage response, a pure helper identifies the primary normalized quota and computes its remaining percentage.
4. The endpoint applies the automatic state transition using `updateProviderConnection`.
5. The original usage response is returned unchanged to the frontend.
6. Quota Tracker refreshes its connection list so the UI reflects the new active state.

This keeps the state decision at the backend data boundary while preserving the existing UI polling and quota rendering behavior.

## Scope

Expected files:

- `src/app/api/usage/[connectionId]/route.js`: evaluate quota and apply automatic state transitions.
- `src/app/api/providers/[id]/route.js`: clear the automatic marker for explicit manual `isActive` changes.
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`: add pure, unit-testable quota evaluation helpers if the existing helpers are insufficient.
- Unit tests for quota evaluation and state transitions.

No database schema migration is required because `providerSpecificData` is already persisted as extensible JSON.

## Error Handling

Quota state changes are best-effort and must not make a successful usage request fail. If persisting the automatic state transition fails, log the error and return the provider usage response normally.

Credential refresh failures and provider usage errors retain the existing API behavior and must never trigger automatic disable or automatic re-enable.

## Tests

Cover these cases:

- Primary quota at `0%` disables an active account.
- Primary quota at `5%` disables an active account.
- A depleted secondary quota does not disable an account when the primary quota is healthy.
- Missing quota, provider message, timeout, and provider error preserve the current state.
- A marked auto-disabled account is re-enabled after quota recovery.
- A manually disabled account without the marker remains disabled after recovery.
- Explicit manual `PUT isActive` clears the marker.
- Existing `providerSpecificData` fields survive marker updates.

