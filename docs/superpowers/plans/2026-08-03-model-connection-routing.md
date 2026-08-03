# Model-to-Connection Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each exact model ID only through its configured provider connection IDs, while preserving current provider-wide fallback for models without a route.

**Architecture:** Store model routes in a dedicated SQLite `modelRoutes` table and expose them through the DB barrel. Add a reusable route resolver that returns either no rule or an explicit connection allowlist. Pass that allowlist into the existing credential selector so cooldown, model-lock, strategy, token refresh, and fallback behavior remain centralized.

**Tech Stack:** Next.js App Router, JavaScript ES modules, SQLite adapter/migrations, React client pages, Vitest.

---

## File Map

- Create `src/lib/db/repos/modelRoutesRepo.js`: CRUD and row conversion for model routes.
- Modify `src/lib/db/schema.js`: declare the `modelRoutes` table and index; bump schema version.
- Create `src/lib/db/migrations/002-model-routes.js`: add the table for existing databases.
- Modify `src/lib/db/migrations/index.js`: register migration 002.
- Modify `src/lib/db/index.js` and `src/lib/localDb.js`: expose route CRUD and include routes in export/import.
- Create `src/sse/services/modelRouting.js`: resolve an exact model route and validate runtime connection membership.
- Modify `src/sse/services/auth.js`: accept an optional allowlist and filter before account selection, including no-auth providers.
- Modify `src/sse/handlers/chat.js`: pass the resolved allowlist into credential selection and return route-specific unavailable errors.
- Create `src/app/api/model-routing/route.js`: list and create routes.
- Create `src/app/api/model-routing/[model]/route.js`: update and delete one route.
- Create `src/app/(dashboard)/dashboard/model-routing/page.js`: manage model IDs and connection selections from the Dashboard.
- Modify `src/shared/components/Sidebar.js`: add Model Routing to the full navigation and keep the simple navigation unchanged.
- Modify `src/shared/components/Header.js`: provide the page title and description for the new route.
- Create `tests/unit/model-routing.test.js`: repository, route resolution, selector filtering, and fallback boundary tests.
- Modify `tests/unit/db-migration-chain.test.js`: assert the new table exists and migrations reach the current version.

### Task 1: Add the persistent model-route repository

**Files:**
- Create: `src/lib/db/repos/modelRoutesRepo.js`
- Modify: `src/lib/db/schema.js`
- Create: `src/lib/db/migrations/002-model-routes.js`
- Modify: `src/lib/db/migrations/index.js`
- Modify: `src/lib/db/index.js`
- Modify: `src/lib/localDb.js`
- Test: `tests/unit/db-migration-chain.test.js`
- Test: `tests/unit/model-routing.test.js`

- [ ] **Step 1: Write failing persistence tests**

Add tests that create a temporary database and verify:

```js
const route = await upsertModelRoute("gpt-5.6-sol", ["a", "b"], true);
expect(route).toMatchObject({
  model: "gpt-5.6-sol",
  connectionIds: ["a", "b"],
  isActive: true,
});
expect(await getModelRouteByModel("gpt-5.6-sol")).toEqual(route);
expect((await getModelRoutes()).map((item) => item.model)).toContain("gpt-5.6-sol");
expect(await deleteModelRoute("gpt-5.6-sol")).toBe(true);
```

Also assert that the migration test sees `modelRoutes` and that the table has
one row per exact model.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js tests/unit/db-migration-chain.test.js
```

Expected: FAIL because the route repository exports and `modelRoutes` table do
not exist yet.

- [ ] **Step 3: Add the schema and migration**

In `src/lib/db/schema.js`, bump `SCHEMA_VERSION` from `1` to `2` and add:

```js
modelRoutes: {
  columns: {
    model: "TEXT PRIMARY KEY",
    connectionIds: "TEXT NOT NULL",
    isActive: "INTEGER DEFAULT 1",
    createdAt: "TEXT NOT NULL",
    updatedAt: "TEXT NOT NULL",
  },
  indexes: ["CREATE INDEX IF NOT EXISTS idx_model_routes_active ON modelRoutes(isActive)"],
},
```

Create migration 002 with an idempotent `CREATE TABLE IF NOT EXISTS` plus the
active index. Register it after migration 001. The declarative schema and
versioned migration must describe the same table.

- [ ] **Step 4: Implement repository CRUD**

Implement these exports in `modelRoutesRepo.js`:

```js
getModelRoutes()
getModelRouteByModel(model)
upsertModelRoute(model, connectionIds, isActive = true)
deleteModelRoute(model)
```

Normalize `model` with `String(model).trim()`, deduplicate connection IDs while
preserving input order, and reject an empty model or an active route with no
connection IDs. Store `connectionIds` as JSON using the existing JSON helpers.
Return objects shaped as `{ model, connectionIds, isActive, createdAt, updatedAt }`.
Use `INSERT ... ON CONFLICT(model) DO UPDATE` so the API has one write path.

- [ ] **Step 5: Expose the repository and preserve database export/import**

Export the four repository functions from `src/lib/db/index.js` and
`src/lib/localDb.js`. Extend `exportDb()` with a `modelRoutes` array and extend
`importDb()` to clear and restore `modelRoutes` in the same transaction as the
other primary entities. Preserve route timestamps when supplied and default
missing timestamps to the current ISO timestamp.

- [ ] **Step 6: Run persistence tests and commit**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js tests/unit/db-migration-chain.test.js
```

Expected: PASS, including migration version `2`, CRUD round-trip, duplicate
model upsert, ordered de-duplicated IDs, and export/import coverage.

Commit:

```bash
git add src/lib/db src/lib/localDb.js tests/unit/db-migration-chain.test.js tests/unit/model-routing.test.js
git commit -m "feat: persist model connection routes"
```

### Task 2: Create the reusable runtime route resolver

**Files:**
- Create: `src/sse/services/modelRouting.js`
- Test: `tests/unit/model-routing.test.js`

- [ ] **Step 1: Write resolver tests**

Cover the explicit distinction between no rule and an active rule with no
usable connections:

```js
expect(await resolveModelConnectionRoute({ provider: "openai", model: "gpt-4" }))
  .toEqual({ hasRule: false, connectionIds: null });

expect(await resolveModelConnectionRoute({ provider: "openai", model: "gpt-5.6-sol" }))
  .toEqual({ hasRule: true, connectionIds: ["a", "b"], invalidConnectionIds: [] });

expect(await resolveModelConnectionRoute({ provider: "openai", model: "gpt-5.6-sol" }))
  .toEqual(expect.objectContaining({ hasRule: true, connectionIds: [] }));
```

Mock the DB repository and provider-connection lookup so tests cover valid IDs,
deleted IDs, provider mismatches, inactive connections, and an active route
that becomes empty after validation. Preserve the configured order.

- [ ] **Step 2: Run the focused resolver tests and verify they fail**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js
```

Expected: FAIL because `modelRouting.js` does not exist.

- [ ] **Step 3: Implement `resolveModelConnectionRoute`**

Implement:

```js
export async function resolveModelConnectionRoute({ provider, model })
```

Behavior:

1. Load the exact route by the resolved bare model ID.
2. Return `{ hasRule: false, connectionIds: null }` when no active route
   exists.
3. Resolve each stored ID with `getProviderConnectionById`.
4. Keep only existing, active connections whose provider equals the resolved
   provider; retain stale/mismatched IDs in `invalidConnectionIds` for logging.
5. Return the remaining ordered IDs in `connectionIds`.

Do not infer wildcard rules or create a route from provider capability data.

- [ ] **Step 4: Run resolver tests and commit**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js
```

Expected: PASS for no-route compatibility, exact route lookup, stale IDs,
provider mismatch, inactive connections, and ordered output.

Commit:

```bash
git add src/sse/services/modelRouting.js tests/unit/model-routing.test.js
git commit -m "feat: resolve model connection allowlists"
```

### Task 3: Apply the allowlist inside credential selection and chat fallback

**Files:**
- Modify: `src/sse/services/auth.js`
- Modify: `src/sse/handlers/chat.js`
- Modify: `tests/unit/model-routing.test.js`

- [ ] **Step 1: Write failing selector and fallback-boundary tests**

Add tests that stub the provider connections and assert:

```js
const first = await getProviderCredentials("openai", null, "gpt-5.6-sol", {
  allowedConnectionIds: ["a", "b"],
});
expect(["a", "b"]).toContain(first.connectionId);
expect(first.connectionId).not.toBe("c");
```

Add an integration-style chat loop test where A fails, B is selected next, and
C is never requested. Add a second test where A and B fail and the final error
does not trigger a third selection.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js
```

Expected: FAIL because `getProviderCredentials` ignores the new option and the
chat handler does not pass route state.

- [ ] **Step 3: Add allowlist filtering to `getProviderCredentials`**

Extend the options object with `allowedConnectionIds`, keeping `null` as the
no-rule value. Before selecting an account, filter provider connections with:

```js
const allowedSet = Array.isArray(options.allowedConnectionIds)
  ? new Set(options.allowedConnectionIds)
  : null;
const scopedConnections = allowedSet
  ? connections.filter((connection) => allowedSet.has(connection.id))
  : connections;
```

Run cooldown/model-lock filtering and the existing fill-first or round-robin
strategy on `scopedConnections`, not on the original provider-wide list.
For a scoped route, return `null`/`allRateLimited` from the scoped list only.
For free no-auth providers, return the virtual `noauth` credential only when
the route explicitly includes `noauth`; otherwise return no credentials for an
active scoped route.

- [ ] **Step 4: Pass route state through the chat handler**

After `getModelInfo(modelStr)` returns `{ provider, model }`, call
`resolveModelConnectionRoute({ provider, model })` once before the retry loop.
Log stale IDs as warnings without exposing secrets. Pass
`allowedConnectionIds: route.hasRule ? route.connectionIds : null` into every
`getProviderCredentials` call.

When `route.hasRule` is true and the scoped selector returns no credentials,
return an unavailable error containing the model and the configured-route
meaning, rather than the generic provider-wide “No active credentials” message.
Keep the existing `excludeConnectionIds` set and add failed IDs to it, so a
retry remains inside the allowlist automatically.

- [ ] **Step 5: Verify combo behavior without changing combo rotation**

Run the existing combo handler tests and the new route tests. Confirm that
`handleSingleModelChat` resolves each combo model independently and that no
combo fallback path calls the selector without the current model's allowlist.

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js tests/unit/combo-routing.test.js tests/unit/combo-autoswitch.test.js
```

Expected: PASS; a model route never grants another model access to its
connections.

- [ ] **Step 6: Commit the runtime enforcement**

```bash
git add src/sse/services/auth.js src/sse/handlers/chat.js tests/unit/model-routing.test.js
git commit -m "feat: enforce model connection routes in chat"
```

### Task 4: Add management APIs with validation

**Files:**
- Create: `src/app/api/model-routing/route.js`
- Create: `src/app/api/model-routing/[model]/route.js`
- Test: `tests/unit/model-routing.test.js`

- [ ] **Step 1: Write API contract tests**

Test these request contracts:

```text
GET  /api/model-routing
POST /api/model-routing
     { "model": "gpt-5.6-sol", "connectionIds": ["a", "b"], "isActive": true }
PUT  /api/model-routing/gpt-5.6-sol
     { "connectionIds": ["b", "a"], "isActive": true }
DELETE /api/model-routing/gpt-5.6-sol
```

Assert that POST/PUT reject missing model, empty active lists, duplicate model
rules, unknown connection IDs, inactive connections, and provider-mismatched
connections with HTTP 400. Assert GET returns route data plus safe connection
metadata (`id`, provider, display name/email) and never credentials.

- [ ] **Step 2: Run API tests and verify they fail**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js
```

Expected: FAIL because the App Router endpoints do not exist.

- [ ] **Step 3: Implement shared API validation**

In `route.js`, normalize the model and connection IDs, resolve the model with
`getModelInfo`, load all requested connections, and validate each one:

```js
if (!model || !Array.isArray(connectionIds) || connectionIds.length === 0) {
  return NextResponse.json({ error: "Model and at least one connectionId are required" }, { status: 400 });
}
if (connections.some((connection) => !connection || connection.isActive === false)) {
  return NextResponse.json({ error: "All selected connections must be active and exist" }, { status: 400 });
}
if (connections.some((connection) => connection.provider !== provider)) {
  return NextResponse.json({ error: "Selected connections must match the model provider" }, { status: 400 });
}
```

Use `upsertModelRoute` for POST and PUT. Treat a deactivated route as a stored
route with `isActive: false`; it behaves like no route at runtime.

- [ ] **Step 4: Implement safe GET and delete responses**

GET should enrich each route with only safe connection fields and include
`invalidConnectionIds` for stale records. The dynamic `[model]` route should
URL-decode the model parameter, return 404 for an unknown route, and delete only
the requested exact model. Never serialize `apiKey`, access tokens, refresh
tokens, or provider-specific secrets.

- [ ] **Step 5: Run API tests and commit**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js
```

Expected: PASS for CRUD responses, validation failures, safe serialization,
and stale-route reporting.

Commit:

```bash
git add src/app/api/model-routing tests/unit/model-routing.test.js
git commit -m "feat: add model routing management API"
```

### Task 5: Add the Dashboard model-routing screen

**Files:**
- Create: `src/app/(dashboard)/dashboard/model-routing/page.js`
- Modify: `src/shared/components/Sidebar.js`
- Modify: `src/shared/components/Header.js`

- [ ] **Step 1: Build the page data contract**

Load `/api/model-routing` and `/api/providers` in parallel. Display each route
as a row with the exact model ID, active state, selected connection labels, and
warnings for stale IDs. Load connection choices from the safe providers API;
never rely on secrets returned by the provider endpoint.

- [ ] **Step 2: Add create/edit controls**

Implement a form that accepts an exact model ID and supports selecting one or
more connection IDs. Filter choices after model resolution when possible, but
keep API validation authoritative. Preserve selected ID order in the request.
Show a confirmation/error state for empty selections, provider mismatch, stale
connections, and failed API responses.

- [ ] **Step 3: Add activate/deactivate and delete actions**

Use PUT to toggle `isActive`, DELETE to remove a route, refresh the list after
each mutation, and show a warning that inactive routes restore legacy
provider-wide behavior. Do not display or edit credentials on this screen.

- [ ] **Step 4: Add navigation and page metadata**

Add `{ href: "/dashboard/model-routing", label: "Model Routing", icon: "alt_route" }`
to the full `navItems` in `Sidebar.js`; do not add it to `simpleNavItems` unless
the existing simple-mode product decision changes. Add a
`pathname.includes("/model-routing")` page-info branch in `Header.js` with title
`Model Routing`, description `Restrict models to specific provider connections`,
and icon `alt_route`.

- [ ] **Step 5: Run the production build and commit**

Run:

```bash
npm run build
```

Expected: Next.js build completes and the new page compiles without client or
server import errors.

Commit:

```bash
git add 'src/app/(dashboard)/dashboard/model-routing/page.js' src/shared/components/Sidebar.js src/shared/components/Header.js
git commit -m "feat: add model routing dashboard"
```

### Task 6: Complete verification and update architecture documentation

**Files:**
- Modify: `tests/unit/db-migration-chain.test.js`
- Modify: `tests/unit/model-routing.test.js`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
npm --prefix tests test -- tests/unit/model-routing.test.js tests/unit/db-migration-chain.test.js tests/unit/combo-routing.test.js tests/unit/combo-autoswitch.test.js
```

Expected: PASS for persistence, API validation, route resolution, selector
scoping, account fallback boundaries, alias resolution, and combo behavior.

- [ ] **Step 2: Run the full available unit suite**

Run:

```bash
npm --prefix tests test
```

Expected: no new failures. If pre-existing failures occur, record their test
names and verify the focused model-routing suite remains green.

- [ ] **Step 3: Update the architecture map**

Document `modelRoutes`, `src/sse/services/modelRouting.js`, the management API,
and the new runtime decision in `docs/ARCHITECTURE.md`. Explicitly state that
an active route is an allowlist and that no-route models retain legacy
provider-wide selection.

- [ ] **Step 4: Run final checks and commit documentation**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files are modified. Commit:

```bash
git add tests/unit/db-migration-chain.test.js tests/unit/model-routing.test.js docs/ARCHITECTURE.md
git commit -m "test: verify model connection routing"
```

