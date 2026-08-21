export const QUOTA_AUTO_DISABLED_KEY = "quotaAutoDisabled";
export const QUOTA_AUTO_DISABLED_AT_KEY = "quotaAutoDisabledAt";
export const QUOTA_AUTO_DISABLED_QUOTA_KEY = "quotaAutoDisabledQuota";
export const QUOTA_AUTO_DISABLED_REMAINING_KEY = "quotaAutoDisabledRemaining";
export const QUOTA_AUTO_DISABLE_ENABLED_KEY = "quotaAutoDisableEnabled";
export const QUOTA_AUTO_DISABLE_THRESHOLD = 5;

export function isQuotaAutoDisableEnabled(providerSpecificData = {}) {
  return providerSpecificData?.[QUOTA_AUTO_DISABLE_ENABLED_KEY] !== false;
}

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
