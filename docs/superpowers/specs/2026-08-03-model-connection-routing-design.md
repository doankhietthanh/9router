# Model-to-Connection Routing Design

## Goal

Allow each exact model ID to use only explicitly configured provider connections.
For example:

```text
gpt-5.6-sol   -> [connectionA, connectionB]
gpt-5.6-lunna -> [connectionC]
```

This prevents a request for `gpt-5.6-sol` from being sent to connection C and
prevents a request for `gpt-5.6-lunna` from being sent to connections A or B.

## Current Problem

The model resolver currently resolves a request to `provider/model`. The auth
selector then considers all active connections for that provider. It does not
have a model-specific allowlist, so a connection that cannot serve a model may
be selected and return an upstream error.

## Approved Design

Add a central database-backed model routing configuration. Each active rule maps
one exact model ID to an ordered list of `connectionId` values:

```js
{
  model: "gpt-5.6-sol",
  connectionIds: ["connectionA", "connectionB"],
  isActive: true
}
```

The rule is keyed by exact model ID. Model aliases are resolved to their target
model before the routing rule is looked up. Wildcards are not supported in the
initial version.

The ordered connection list is retained for future priority behavior. The
initial implementation may reuse the existing account selection algorithm as
long as it only considers connections in the allowlist.

## Runtime Flow

1. Receive the requested model string.
2. Resolve provider and model using the existing model resolver.
3. Resolve any model alias to its canonical model ID.
4. Look up the exact model routing rule.
5. If no active rule exists, preserve the current provider-wide account
   selection behavior for backward compatibility.
6. If an active rule exists, load only the listed connections and filter them
   by:
   - connection existence;
   - matching resolved provider;
   - active status;
   - cooldown and model-lock state;
   - connections not already attempted for this request.
7. Select credentials from the remaining allowlisted connections.
8. On a fallback-eligible upstream error, apply the existing cooldown/error
   state and try the next allowlisted connection only.
9. If the allowlist is exhausted, return a model-unavailable error. Never fall
   back to an unconfigured connection for a model with an active rule.

The allowlist must be applied before credential selection, rather than after an
account has already been selected.

## Persistence and Management

Use a dedicated model-routing entity/collection in the primary local database,
rather than adding routing fields to provider connections. The entity should
enforce one rule per exact model ID.

The management API and Dashboard should support:

- listing, creating, updating, activating, and deactivating model routes;
- selecting multiple connections by `connectionId`;
- displaying provider and masked account labels for those IDs;
- validating that each selected connection exists and belongs to the resolved
  provider;
- warning when a connection is deleted or no longer matches a route.

An active rule must not be saved with an empty connection list. Runtime logic
must still handle stale records defensively because connections can be removed
or changed outside the route edit operation.

## Error Handling

- **No route:** retain the existing provider-wide behavior.
- **No usable allowlisted connection:** return a clear error that includes the
  requested model and indicates that no configured connection is available.
- **Stale or mismatched connection:** ignore it at runtime and record a warning;
  management validation should prevent new invalid rules.
- **401/429/5xx or other fallback-eligible errors:** use existing account
  cooldown and fallback behavior within the allowlist.
- **All allowlisted connections exhausted:** return the final failure and do
  not try another account from the provider.
- **Successful request:** retain existing account-state reset behavior.
- **Combos:** resolve routing independently for each model in the combo. A
  combo does not grant permission to use connections outside the active rule
  for its current model.

## Initial Scope

The first implementation should wire the rule into the shared chat model
credential-selection path and keep the routing lookup reusable for other
model-based handlers. Embeddings, search, image, audio, and video handlers are
not changed unless they already share the same credential-selection contract;
expanding those handlers is a follow-up scope decision.

## Acceptance Tests

1. A `gpt-5.6-sol` request selects only connection A or B.
2. A `gpt-5.6-lunna` request selects only connection C.
3. If A fails for `gpt-5.6-sol`, fallback can select B.
4. If A and B fail, the request fails without trying C.
5. A model with no route continues to use the existing behavior.
6. An alias resolves to its canonical model before route lookup.
7. A route containing a deleted or mismatched connection cannot cause an
   unallowlisted connection to be selected.
8. Cooldown and model-lock filtering work within the configured list.
9. Combo models apply their own independent routes.
10. Dashboard/API validation rejects duplicate model rules, empty active
    routes, unknown connection IDs, and provider-mismatched connections.

## Alternatives Considered

### Dedicated model-route entity with extensive policy metadata

This could support per-route priority, enablement, fallback policy, and notes.
It is more flexible but adds schema, API, and UI complexity that is not needed
for the first requirement.

### `allowedModels` on every provider connection

This keeps configuration next to each account, but requires scanning all
connections to answer which accounts serve a model. It is harder to audit and
less direct than a central model-to-connection mapping.

## Non-Goals

- Wildcard or pattern-based model matching.
- Fallback to accounts outside an active model route.
- Automatic discovery of model capability from upstream providers.
- Changing existing combo semantics beyond applying each model's route.
- Replacing the existing cooldown, model-lock, or account selection algorithms.
