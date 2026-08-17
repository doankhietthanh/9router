# Quota Tracker Auto-Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically disable active provider connections when their primary quota reaches 5% or less, and automatically re-enable only connections previously disabled by this mechanism after quota recovery.

**Architecture:** Keep quota evaluation in a small server-safe pure helper. The existing usage endpoint applies the state transition after a successful provider response, while the provider PUT endpoint clears the marker for explicit manual state changes. The existing Quota Tracker refresh flow consumes a small state-change flag so the visible account list updates immediately.

**Tech Stack:** Next.js App Router route handlers, JavaScript ES modules, provider usage services, JSON-backed `providerSpecificData`, Vitest.

---

## File Map

- Create `src/lib/quotaAutoDisable.js`: pure quota selection, remaining-percentage evaluation, and marker payload helpers.
- Create `tests/unit/quota-auto-disable.test.js`: unit tests for quota interpretation and marker transitions.
- Modify `src/app/api/usage/[connectionId]/route.js`: evaluate successful usage responses and persist automatic state changes without changing error behavior.
- Modify `src/app/api/providers/[id]/route.js`: clear auto-disable metadata when the user explicitly updates `isActive`.
- Modify `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`: consume the endpoint state-change result and refresh the current connection page when needed.

### Task 1: Add the pure quota state helper

**Files:**
- Create: `src/lib/quotaAutoDisable.js`
- Test: `tests/unit/quota-auto-disable.test.js`

- [ ] **Step 1: Write failing tests for primary-quota evaluation**

Create tests covering the actual helper contract:

```js
import { describe, expect, it } from "vitest";
import {
  evaluatePrimaryQuota,
  buildQuotaAutoDisableData,
  clearQuotaAutoDisableData,
} from "@/lib/quotaAutoDisable";

describe("quota auto-disable", () => {
  it("uses the first quota as the primary quota and disables at 5%", () => {
    expect(evaluatePrimaryQuota({
      session: { remaining: 5, used: 95, total: 100 },
      weekly: { remaining: 100, used: 0, total: 100 },
    })).toMatchObject({ depleted: true, remaining: 5, quotaName: "session" });
  });

  it("does not disable when only a secondary quota is depleted", () => {
    expect(evaluatePrimaryQuota({
      session: { remaining: 80, used: 20, total: 100 },
      weekly: { remaining: 0, used: 100, total: 100 },
    })).toMatchObject({ depleted: false, remaining: 80, quotaName: "session" });
  });

  it("falls back to used and total when remaining is absent", () => {
    expect(evaluatePrimaryQuota({
      primary: { used: 100, total: 100 },
    })).toMatchObject({ depleted: true, remaining: 0 });
  });

  it("returns an unevaluable result for missing or malformed quota data", () => {
    expect(evaluatePrimaryQuota({})).toMatchObject({ evaluable: false });
    expect(evaluatePrimaryQuota({ session: null })).toMatchObject({ evaluable: false });
  });

  it("builds and clears only the auto-disable metadata", () => {
    const original = { chatgptAccountId: "acct-1", proxyPoolId: "pool-1" };
    const marked = buildQuotaAutoDisableData(original, { quotaName: "session", remaining: 0 });
    expect(marked).toMatchObject({
      chatgptAccountId: "acct-1",
      proxyPoolId: "pool-1",
      quotaAutoDisabled: true,
      quotaAutoDisabledQuota: "session",
      quotaAutoDisabledRemaining: 0,
    });
    expect(clearQuotaAutoDisableData(marked)).toEqual(original);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-auto-disable.test.js
```

Expected: FAIL because `src/lib/quotaAutoDisable.js` does not exist yet.

- [ ] **Step 3: Implement the minimal pure helper**

Implement these exports in `src/lib/quotaAutoDisable.js`:

```js
export const QUOTA_AUTO_DISABLED_KEY = "quotaAutoDisabled";
export const QUOTA_AUTO_DISABLED_AT_KEY = "quotaAutoDisabledAt";
export const QUOTA_AUTO_DISABLED_QUOTA_KEY = "quotaAutoDisabledQuota";
export const QUOTA_AUTO_DISABLED_REMAINING_KEY = "quotaAutoDisabledRemaining";
export const QUOTA_AUTO_DISABLE_THRESHOLD = 5;

function finiteNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function evaluatePrimaryQuota(quotas) {
  const entries = Object.entries(quotas || {});
  if (entries.length === 0) return { evaluable: false, depleted: false };

  const [quotaName, quota] = entries[0];
  if (!quota || typeof quota !== "object") {
    return { evaluable: false, depleted: false, quotaName };
  }

  const remaining = finiteNumber(quota.remaining ?? quota.remainingPercentage);
  const used = finiteNumber(quota.used);
  const total = finiteNumber(quota.total);
  const computedRemaining = remaining ?? (
    total !== null && total > 0 && used !== null
      ? Math.max(0, Math.min(100, Math.round(((total - used) / total) * 100)))
      : null
  );

  if (computedRemaining === null) {
    return { evaluable: false, depleted: false, quotaName };
  }

  return {
    evaluable: true,
    depleted: computedRemaining <= QUOTA_AUTO_DISABLE_THRESHOLD,
    quotaName,
    remaining: computedRemaining,
  };
}

export function buildQuotaAutoDisableData(providerSpecificData = {}, evaluation, now = new Date().toISOString()) {
  return {
    ...providerSpecificData,
    [QUOTA_AUTO_DISABLED_KEY]: true,
    [QUOTA_AUTO_DISABLED_AT_KEY]: now,
    [QUOTA_AUTO_DISABLED_QUOTA_KEY]: evaluation.quotaName,
    [QUOTA_AUTO_DISABLED_REMAINING_KEY]: evaluation.remaining,
  };
}

export function clearQuotaAutoDisableData(providerSpecificData = {}) {
  const next = { ...providerSpecificData };
  delete next[QUOTA_AUTO_DISABLED_KEY];
  delete next[QUOTA_AUTO_DISABLED_AT_KEY];
  delete next[QUOTA_AUTO_DISABLED_QUOTA_KEY];
  delete next[QUOTA_AUTO_DISABLED_REMAINING_KEY];
  return next;
}
```

The helper must treat `remaining` and `remainingPercentage` as percentages because the normalized quota contract uses a 0-100 remaining scale. It must never infer depletion from absent or non-finite values.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/quota-auto-disable.test.js
```

Expected: all quota helper tests pass.

- [ ] **Step 5: Commit the helper and tests**

```bash
git add src/lib/quotaAutoDisable.js tests/unit/quota-auto-disable.test.js
git commit -m "test: add quota auto-disable evaluation"
```

### Task 2: Apply automatic state transitions in the usage endpoint

**Files:**
- Modify: `src/app/api/usage/[connectionId]/route.js`
- Test: `tests/unit/usage-auto-disable-route.test.js`

- [ ] **Step 1: Add route-level failing cases**

Mock `@/lib/localDb`, `open-sse/services/usage.js`, `@/lib/network/connectionProxy`, and credential refresh dependencies. Assert these exact transitions after `GET`:

```js
expect(updateProviderConnection).toHaveBeenCalledWith(
  "conn-1",
  expect.objectContaining({
    isActive: false,
    providerSpecificData: expect.objectContaining({
      quotaAutoDisabled: true,
      quotaAutoDisabledQuota: "session",
    }),
  }),
);
```

Also assert that a healthy quota re-enables only a connection whose original `providerSpecificData.quotaAutoDisabled` is `true`, while a manually inactive connection without that marker receives no state update.

- [ ] **Step 2: Run the route tests and verify they fail**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/usage-auto-disable-route.test.js
```

Expected: FAIL because the usage route currently returns usage without applying quota state transitions.

- [ ] **Step 3: Add a best-effort transition helper to the usage route**

After the provider usage call and any existing auth-expired retry, evaluate `usage.quotas`. The route must:

```js
const evaluation = evaluatePrimaryQuota(usage?.quotas);
let quotaStateChanged = false;

if (evaluation.evaluable) {
  const autoDisabled = connection.providerSpecificData?.quotaAutoDisabled === true;
  if (evaluation.depleted && connection.isActive !== false) {
    await updateProviderConnection(connection.id, {
      isActive: false,
      providerSpecificData: buildQuotaAutoDisableData(
        connection.providerSpecificData,
        evaluation,
      ),
      updatedAt: new Date().toISOString(),
    });
    quotaStateChanged = true;
  } else if (!evaluation.depleted && autoDisabled) {
    await updateProviderConnection(connection.id, {
      isActive: true,
      providerSpecificData: clearQuotaAutoDisableData(connection.providerSpecificData),
      updatedAt: new Date().toISOString(),
    });
    quotaStateChanged = true;
  }
}
```

Wrap only the persistence transition in `try/catch`; log a warning and continue returning usage if persistence fails. Do not call this block for thrown provider errors, auth refresh failures, empty quota data, or message-only responses.

Return the existing usage payload plus a non-provider control field:

```js
return Response.json({ ...usage, quotaStateChanged });
```

The control field is for the dashboard and must not alter the provider quota payload.

- [ ] **Step 4: Run route tests and existing quota tests**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/usage-auto-disable-route.test.js tests/unit/quota-auto-disable.test.js tests/unit/quota-auto-ping.test.js
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit the endpoint transition**

```bash
git add 'src/app/api/usage/[connectionId]/route.js' tests/unit/usage-auto-disable-route.test.js
git commit -m "feat: auto-disable depleted quota connections"
```

### Task 3: Preserve manual account state changes

**Files:**
- Modify: `src/app/api/providers/[id]/route.js`
- Test: `tests/unit/provider-connection-status.test.js`

- [ ] **Step 1: Add a failing test for explicit manual `isActive` updates**

Use an existing connection containing quota auto-disable metadata. Send a PUT body with `isActive: false` and assert the repository update clears all four auto-disable keys while preserving unrelated metadata:

```js
expect(updateProviderConnection).toHaveBeenCalledWith(
  "conn-1",
  expect.objectContaining({
    isActive: false,
    providerSpecificData: {
      chatgptAccountId: "acct-1",
    },
  }),
);
```

- [ ] **Step 2: Run the focused route test and verify it fails**

```bash
npx vitest run --config tests/vitest.config.js tests/unit/provider-connection-status.test.js
```

Expected: FAIL because the current PUT handler merges provider-specific data and leaves quota markers intact.

- [ ] **Step 3: Clear markers only for explicit `isActive` updates**

In the existing `if (isActive !== undefined)` branch, use `clearQuotaAutoDisableData(existing.providerSpecificData)` as the base provider-specific data before applying any caller-supplied `providerSpecificData`. Do not clear markers for unrelated PUT updates such as name, priority, proxy, or model changes.

- [ ] **Step 4: Run the focused test and verify it passes**

```bash
npx vitest run --config tests/vitest.config.js tests/unit/provider-connection-status.test.js
```

Expected: all manual-state tests pass.

- [ ] **Step 5: Commit the manual-state protection**

```bash
git add 'src/app/api/providers/[id]/route.js' tests/unit/provider-connection-status.test.js
git commit -m "fix: preserve manual quota connection state"
```

### Task 4: Refresh the Quota Tracker connection list after state changes

**Files:**
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js`
- Test: production build verification; this repository has no existing component test harness for this page.

- [ ] **Step 1: Return a state-change flag from `fetchQuota`**

After parsing the usage response, return `data.quotaStateChanged === true` from `fetchQuota`. Preserve the existing quota state/cache behavior.

- [ ] **Step 2: Refresh the current page when any quota request changes account state**

In both initial loading and `refreshAll`, collect the boolean results from `Promise.all`. If any result is true, call `fetchConnections(page)` once after the batch completes. Do not call `fetchConnections` once per connection.

- [ ] **Step 3: Verify the UI behavior**

Run:

```bash
npm run build
```

Expected: Next.js compiles successfully. Build-time database `EPERM` messages under `/Users/doankhietthanh/.9router/db/data.sqlite` may appear in this environment but must not cause a non-zero exit.

- [ ] **Step 4: Commit the refresh integration**

```bash
git add 'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js'
git commit -m "feat: refresh quota accounts after auto state changes"
```

### Task 5: Run final verification

**Files:**
- Verify: all files above

- [ ] **Step 1: Run all focused tests**

```bash
npx vitest run --config tests/vitest.config.js \
  tests/unit/quota-auto-disable.test.js \
  tests/unit/usage-auto-disable-route.test.js \
  tests/unit/provider-connection-status.test.js \
  tests/unit/quota-auto-ping.test.js
```

Expected: all listed tests pass.

- [ ] **Step 2: Check the final diff for whitespace and unresolved markers**

```bash
git diff --check HEAD~4..HEAD
rg -n '^(<<<<<<<|=======|>>>>>>>)' src tests || true
```

Expected: no merge markers; any pre-existing unrelated whitespace warnings must be reported separately.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: build exits with code 0 and includes the usage/provider routes.

- [ ] **Step 4: Review working tree and summarize**

```bash
git status --short --branch
git log --oneline -6
```

Confirm `.vscode/settings.json` remains unrelated and uncommitted if still present.
