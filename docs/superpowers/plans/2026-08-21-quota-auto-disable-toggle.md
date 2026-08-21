# Quota Auto-Disable Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-account quota auto-disable toggle that defaults to enabled, while keeping it independent from the manual connection status toggle.

**Architecture:** Store `quotaAutoDisableEnabled` in the existing merged `providerSpecificData` JSON. Add a small helper for the default-enabled rule, guard both quota-driven state transitions in the usage route, and add a second toggle beside the existing `isActive` toggle in the quota dashboard. The existing provider update endpoint remains the persistence boundary.

**Tech Stack:** Next.js App Router, React client components, JavaScript, Vitest, existing local DB/provider APIs.

---

## File Map

- Modify `src/lib/quotaAutoDisable.js`: expose the default-enabled setting key and a pure predicate for whether quota automation is enabled.
- Modify `src/app/api/usage/[connectionId]/route.js`: skip quota auto-disable and auto-enable transitions when the account setting is explicitly false.
- Modify `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`: render and persist the per-account toggle beside the manual connection toggle.
- Modify `src/shared/components/Toggle.js`: accept an optional accessible label for compact unlabeled toggles.
- Modify `tests/unit/quota-auto-disable.test.js`: cover the default-enabled predicate and explicit false behavior.
- Modify `tests/unit/usage-auto-disable-route.test.js`: verify the usage route does not change state when automation is disabled.
- Modify `tests/unit/provider-connection-status.test.js`: verify provider metadata updates preserve the setting and existing quota markers behavior remains intact.

### Task 1: Add the default-enabled quota setting helper

**Files:**
- Modify: `src/lib/quotaAutoDisable.js`
- Test: `tests/unit/quota-auto-disable.test.js`

- [ ] **Step 1: Write failing unit tests for setting semantics**

Add tests alongside the existing quota helper tests:

```js
import {
  isQuotaAutoDisableEnabled,
  QUOTA_AUTO_DISABLE_ENABLED_KEY,
} from "@/lib/quotaAutoDisable";

it("defaults quota auto-disable to enabled when the setting is absent", () => {
  expect(isQuotaAutoDisableEnabled({})).toBe(true);
  expect(isQuotaAutoDisableEnabled({ chatgptAccountId: "acct-1" })).toBe(true);
});

it("disables quota automation only when the setting is explicitly false", () => {
  expect(isQuotaAutoDisableEnabled({ [QUOTA_AUTO_DISABLE_ENABLED_KEY]: true })).toBe(true);
  expect(isQuotaAutoDisableEnabled({ [QUOTA_AUTO_DISABLE_ENABLED_KEY]: false })).toBe(false);
  expect(isQuotaAutoDisableEnabled({ [QUOTA_AUTO_DISABLE_ENABLED_KEY]: "false" })).toBe(true);
});
```

- [ ] **Step 2: Run the focused helper test and verify it fails**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-auto-disable.test.js
```

Expected: FAIL because the new export does not exist yet.

- [ ] **Step 3: Implement the minimal helper**

In `src/lib/quotaAutoDisable.js`, add the constant and predicate next to the
existing marker constants:

```js
export const QUOTA_AUTO_DISABLE_ENABLED_KEY = "quotaAutoDisableEnabled";

export function isQuotaAutoDisableEnabled(providerSpecificData = {}) {
  return providerSpecificData?.[QUOTA_AUTO_DISABLE_ENABLED_KEY] !== false;
}
```

Do not alter the threshold, quota evaluation, marker creation, or marker
clearing functions.

- [ ] **Step 4: Run the helper test and verify it passes**

Run the same Vitest command. Expected: the quota helper test file passes.

- [ ] **Step 5: Commit the helper and tests**

```bash
git add src/lib/quotaAutoDisable.js tests/unit/quota-auto-disable.test.js
git commit -m "feat: add quota auto-disable setting helper"
```

### Task 2: Guard quota-driven backend state transitions

**Files:**
- Modify: `src/app/api/usage/[connectionId]/route.js`
- Test: `tests/unit/usage-auto-disable-route.test.js`

- [ ] **Step 1: Add failing route tests for disabled automation**

Add one test for each transition to `tests/unit/usage-auto-disable-route.test.js`.
The first connection is active and depleted; the second is inactive with an
existing quota marker and recovered quota:

```js
it("does not auto-disable when quota automation is explicitly disabled", async () => {
  const connection = {
    id: "conn-1",
    provider: "codex",
    authType: "oauth",
    isActive: true,
    accessToken: "access-token",
    providerSpecificData: { quotaAutoDisableEnabled: false },
  };
  mocks.getProviderConnectionById.mockResolvedValue(connection);
  mocks.getUsageForProvider.mockResolvedValue({
    quotas: { session: { remaining: 0, used: 100, total: 100 } },
  });

  const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
    params: Promise.resolve({ connectionId: "conn-1" }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ quotaStateChanged: false });
  expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
});

it("does not auto-enable when quota automation is explicitly disabled", async () => {
  const connection = {
    id: "conn-1",
    provider: "codex",
    authType: "oauth",
    isActive: false,
    accessToken: "access-token",
    providerSpecificData: {
      quotaAutoDisableEnabled: false,
      quotaAutoDisabled: true,
      quotaAutoDisabledQuota: "session",
      quotaAutoDisabledRemaining: 0,
    },
  };
  mocks.getProviderConnectionById.mockResolvedValue(connection);
  mocks.getUsageForProvider.mockResolvedValue({
    quotas: { session: { remaining: 80, used: 20, total: 100 } },
  });

  const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
    params: Promise.resolve({ connectionId: "conn-1" }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ quotaStateChanged: false });
  expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the route test and verify the new tests fail**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/usage-auto-disable-route.test.js
```

Expected: the two new tests fail because the route currently transitions state
without checking account metadata.

- [ ] **Step 3: Add the guard to the usage route**

Import `isQuotaAutoDisableEnabled` and gate the existing transition block:

```js
const quotaAutoDisableEnabled = isQuotaAutoDisableEnabled(
  connection.providerSpecificData,
);
if (evaluation.evaluable && quotaAutoDisableEnabled) {
  const autoDisabled = connection.providerSpecificData?.quotaAutoDisabled === true;
  // Keep the existing depleted/recovered transition branches unchanged here.
}
```

The implementation should leave `quotaStateChanged` false and must not call
`updateProviderConnection` when the setting is false. Missing metadata and a
boolean true must continue through the existing branches.

- [ ] **Step 4: Run all quota state tests**

```bash
npx vitest run --config tests/vitest.config.js \
  tests/unit/quota-auto-disable.test.js \
  tests/unit/usage-auto-disable-route.test.js \
  tests/unit/provider-connection-status.test.js \
  tests/unit/quota-auto-ping.test.js
```

Expected: all existing and new quota state tests pass.

- [ ] **Step 5: Commit the backend change**

```bash
git add src/app/api/usage/[connectionId]/route.js tests/unit/usage-auto-disable-route.test.js
git commit -m "feat: respect per-account quota auto-disable setting"
```

### Task 3: Add the per-account dashboard toggle

**Files:**
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`
- Inspect: `src/app/api/providers/[id]/route.js` to confirm its existing merge path preserves the new metadata.
- Test: `tests/unit/provider-connection-status.test.js`

- [ ] **Step 1: Add a persistence test for the setting**

Add a test proving the existing provider update route merges the new setting
with unrelated metadata:

```js
it("persists quota automation setting without dropping provider metadata", async () => {
  const providerSpecificData = {
    chatgptAccountId: "acct-1",
    proxyPoolId: "pool-1",
  };
  mocks.getProviderConnectionById.mockResolvedValue({
    id: "conn-1",
    provider: "codex",
    providerSpecificData,
  });

  const response = await PUT(
    new Request("http://localhost/api/providers/conn-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerSpecificData: { quotaAutoDisableEnabled: false },
      }),
    }),
    { params: Promise.resolve({ id: "conn-1" }) },
  );

  expect(response.status).toBe(200);
  expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-1", {
    providerSpecificData: {
      chatgptAccountId: "acct-1",
      proxyPoolId: "pool-1",
      quotaAutoDisableEnabled: false,
    },
  });
});
```

- [ ] **Step 2: Run the persistence test and verify the current route behavior**

```bash
npx vitest run --config tests/vitest.config.js tests/unit/provider-connection-status.test.js
```

Expected: the merge test passes with the current route because the route
already merges `providerSpecificData` and only clears quota markers for an
explicit `isActive` update. Keep the provider route unchanged.

- [ ] **Step 3: Add a dedicated per-account toggle handler in the dashboard**

In `ProviderLimits/index.js`, add state next to `togglingId`:

```js
const [quotaAutoDisableTogglingId, setQuotaAutoDisableTogglingId] = useState(null);
```

Add a handler next to `handleToggleConnectionActive` that sends only the
changed provider metadata while preserving the account object already loaded:

```js
const handleToggleQuotaAutoDisable = useCallback(
  async (connection, enabled) => {
    setQuotaAutoDisableTogglingId(connection.id);
    try {
      const res = await fetch(`/api/providers/${connection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerSpecificData: {
            ...(connection.providerSpecificData || {}),
            quotaAutoDisableEnabled: enabled,
          },
        }),
      });
      if (res.ok) await reconcileConnectionsPage(fetchConnections, page);
    } catch (error) {
      console.error("Error updating quota auto-disable setting:", error);
    } finally {
      setQuotaAutoDisableTogglingId(null);
    }
  },
  [fetchConnections, page],
);
```

Use a separate busy condition so changing the quota setting cannot accidentally
change the manual connection status. The row should be disabled while either
toggle is saving:

```js
const quotaAutoDisableEnabled = conn.providerSpecificData?.quotaAutoDisableEnabled !== false;
const quotaAutoDisableBusy = quotaAutoDisableTogglingId === conn.id;
const rowBusy = deletingId === conn.id
  || togglingId === conn.id
  || quotaAutoDisableBusy
  || isResettingLimit;
```

- [ ] **Step 4: Render the new toggle with an explicit accessible label**

Place the new control immediately before the existing `isActive` toggle:

```jsx
<div
  className="inline-flex items-center pl-0.5"
  title={quotaAutoDisableEnabled
    ? "Auto-disable on quota depletion"
    : "Quota auto-disable is off"}
>
  <Toggle
    size="sm"
    checked={quotaAutoDisableEnabled}
    disabled={rowBusy}
    ariaLabel="Auto-disable on quota depletion"
    onChange={(enabled) => handleToggleQuotaAutoDisable(conn, enabled)}
  />
</div>
```

Update `src/shared/components/Toggle.js` to accept `ariaLabel = undefined` and
pass it to the switch button as `aria-label={ariaLabel}`. Also set
`ariaLabel="Toggle connection status"` on the existing manual toggle so both
compact controls have distinct accessible names. The visible title text should
remain specific to each control.

- [ ] **Step 5: Verify UI metadata and callback integration**

Run the existing lint/type/build checks available in the repository after the
handler and JSX compile:

```bash
npx eslint 'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js' src/shared/components/Toggle.js src/lib/quotaAutoDisable.js
```

Expected: no new lint errors. Confirm the account update request contains the
full merged `providerSpecificData` object and that the manual `isActive` request
still sends only `{ isActive }`.

- [ ] **Step 6: Commit the dashboard change**

```bash
git add 'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js' src/shared/components/Toggle.js tests/unit/provider-connection-status.test.js
git commit -m "feat: add per-account quota auto-disable toggle"
```

### Task 4: Final verification

**Files:**
- No source changes expected unless verification identifies a concrete failure.

- [ ] **Step 1: Run the focused regression suite**

```bash
npx vitest run --config tests/vitest.config.js \
  tests/unit/quota-auto-disable.test.js \
  tests/unit/usage-auto-disable-route.test.js \
  tests/unit/provider-connection-status.test.js \
  tests/unit/quota-auto-ping.test.js
```

Expected: all four files pass, including the new default-enabled and disabled-
automation cases.

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: the Next.js production build exits successfully. If the existing
environment-specific SQLite `EPERM` warning appears while the build still exits
0, report it separately and do not treat it as a feature regression.

- [ ] **Step 3: Check the final diff and worktree**

```bash
git diff --check HEAD~3..HEAD
git status --short
```

Expected: no whitespace errors; only the intentional feature commits are
included, while the pre-existing `.vscode/settings.json` modification remains
untouched.
