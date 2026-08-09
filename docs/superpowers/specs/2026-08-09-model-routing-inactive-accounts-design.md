# Model Routing Inactive Accounts Design

## Objective

Allow Model Routing rules to include inactive provider accounts without allowing those accounts to handle requests while they remain inactive.

## Current Behavior

- The Model Routing page removes inactive accounts from the account picker.
- The Model Routing POST and PUT APIs reject any selected inactive account.
- Runtime route resolution excludes missing, inactive, or provider-mismatched accounts.

## Design

### Dashboard

The Add Router and Edit Router modal will load all provider accounts instead of filtering out inactive accounts. Each account option will show an `Active` or `Inactive` status so users can distinguish its current availability.

The empty-state message will refer to accounts generally rather than active accounts only. Model selection will continue receiving the available connection list so the existing provider/model selection behavior remains intact.

### Management API

The Model Routing POST and PUT validation will accept a selected connection when it:

- exists; and
- belongs to the provider resolved for the selected model.

The connection's `isActive` value will not prevent the route from being saved. Missing connections and provider mismatches will continue to return a validation error.

### Runtime Routing

Runtime behavior will not change. When an active model route is resolved, only connections that currently exist, are active, and match the model provider are eligible.

An inactive connection remains in the stored ordered allowlist but is skipped while inactive. If it is activated later, it becomes eligible automatically in its saved position without requiring the route to be edited again.

If every configured connection is unavailable or inactive, the active route remains fail-closed and does not fall back to an account outside the allowlist.

## Error Handling

- Saving a missing connection will fail with a clear existence validation error.
- Saving a connection from another provider will retain the existing provider mismatch error.
- Inactive connections will not cause a save error.

## Testing

- Add an API test proving that POST accepts an inactive connection for the correct provider.
- Add or update an API test proving that PUT accepts an inactive connection for the correct provider.
- Preserve the runtime resolution test proving inactive connections are excluded from eligible connection IDs.
- Add a focused UI/helper test if the current test setup supports testing the account-list transformation without introducing a new frontend test framework.
- Run the focused Model Routing unit tests, ESLint on changed source files, and `git diff --check`.

## Out Of Scope

- Sending requests through inactive accounts.
- Automatically activating an account when it is assigned to a route.
- Changing account ordering or adding drag-and-drop behavior.
- Changing provider-wide fallback behavior for models without an active route.
