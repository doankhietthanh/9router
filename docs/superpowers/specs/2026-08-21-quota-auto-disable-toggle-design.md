# Quota Auto-Disable Toggle Per Account

## Context

Quota auto-disable currently changes a provider connection's `isActive` state
when its primary quota reaches the depletion threshold. This is useful for
single-quota accounts, but providers such as Antigravity expose multiple model
quotas through one account. A single depleted model quota can therefore disable
the whole account prematurely.

The product needs a per-account control that determines whether quota polling
may automatically disable and re-enable that account. The existing connection
disable control remains an independent manual control.

## Goals

- Add a per-account toggle for quota-driven auto-disable behavior.
- Apply the toggle to every account that supports quota polling.
- Preserve current behavior for existing accounts by defaulting the setting to
  enabled when it is absent.
- Keep manual connection status control separate from quota automation.
- Avoid a database migration by storing the setting in the existing
  `providerSpecificData` JSON object.

## Non-goals

- Changing the quota depletion threshold or primary-quota selection rules.
- Adding provider-specific logic for Antigravity.
- Changing runtime eligibility rules beyond the existing `isActive` behavior.
- Adding a global setting that controls all accounts.

## Data Model

Store the boolean metadata field `quotaAutoDisableEnabled` in
`providerSpecificData`:

- `true`: quota polling may auto-disable an active account at the existing
  threshold and auto-enable an account previously auto-disabled after recovery.
- `false`: quota polling must not perform either automatic state transition.
- missing: treat as `true` for backward compatibility.

All provider-specific metadata must be merged with the existing object. Updating
this setting must not remove credentials, provider configuration, proxy
configuration, or quota markers.

## User Interface

In the per-account quota row/card, show a toggle next to the existing
connection `isActive` toggle:

- Existing toggle: `Disable connection`, controls whether the account is active
  for request routing.
- New toggle: `Auto-disable on quota depletion`, controls only quota-driven
  status transitions.

The new toggle is checked when `providerSpecificData.quotaAutoDisableEnabled`
is not `false`. It should use the same loading/disabled treatment as the
existing connection toggle and persist through `PUT /api/providers/[id]`.

When a user manually changes `isActive`, the current behavior remains: quota
auto-disable markers are cleared so a manual status decision is not mistaken
for an automatic transition. Changing the new toggle alone must not clear or
alter `isActive`.

## Backend Flow

1. The UI sends `providerSpecificData.quotaAutoDisableEnabled` through the
   existing provider update route.
2. The provider update route merges the submitted metadata with the stored
   metadata and persists the result.
3. The usage route evaluates quota data as it does today.
4. Before applying an automatic state transition, the usage route checks the
   account setting. Missing or `true` allows the existing transition logic;
   `false` returns the quota response without changing `isActive` or quota
   markers.
5. The dashboard refresh behavior remains unchanged when a state transition
   actually occurs.

Disabling the setting must not automatically re-enable an account that was
previously disabled by quota. The account remains inactive until the user
manually changes its connection status.

## Error Handling

- A failed provider update must leave the UI toggle at its previous value and
  show the existing error behavior.
- A malformed or missing setting is treated as enabled only when the field is
  absent; a non-boolean value should be normalized safely by the route or
  treated as enabled by the quota evaluator rather than disabling safety logic.
- Usage endpoint failures and malformed quota responses retain the current
  behavior and must not change account state.
- Persistence failures during quota processing remain best-effort and must not
  turn a successful quota response into an error.

## Testing

Add focused tests covering:

- Existing accounts without the field continue to auto-disable and auto-enable.
- `quotaAutoDisableEnabled: true` preserves the existing behavior.
- `quotaAutoDisableEnabled: false` prevents auto-disable at the threshold.
- `quotaAutoDisableEnabled: false` prevents auto-enable after recovery.
- Toggling the setting preserves unrelated provider metadata.
- Updating `isActive` continues to clear quota auto-disable markers.
- The UI renders the new toggle as checked unless the field is explicitly
  `false`, and sends the expected provider update payload.

## Acceptance Criteria

- Every quota-capable account exposes the new toggle in the quota UI.
- Existing accounts behave exactly as before until the toggle is turned off.
- Turning the toggle off prevents quota polling from disabling or re-enabling
  that account.
- The manual `Disable connection` toggle remains independent and functional.
- Focused unit tests pass, followed by the project build.
