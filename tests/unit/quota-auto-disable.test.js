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
