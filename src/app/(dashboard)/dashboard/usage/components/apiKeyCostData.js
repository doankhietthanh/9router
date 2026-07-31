const DEFAULT_LIMIT = 8;

function toNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function getDisplayName(item = {}) {
  if (item.keyName) return item.keyName;
  if (item.apiKeyMasked) return item.apiKeyMasked;
  if (item.apiKeyKey === "local-no-key") return "Local (No API Key)";
  if (item.apiKeyKey) return item.apiKeyKey;
  return "Unknown API Key";
}

function getLatestTime(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(b) > new Date(a) ? b : a;
}

export function buildApiKeyCostRows(byApiKey, limit = DEFAULT_LIMIT) {
  if (!byApiKey || typeof byApiKey !== "object") return [];

  const grouped = new Map();

  for (const item of Object.values(byApiKey)) {
    const keyName = getDisplayName(item);
    const current = grouped.get(keyName) || {
      id: keyName,
      keyName,
      apiKeyMasked: item?.apiKeyMasked || null,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      cost: 0,
      lastUsed: null,
    };

    current.requests += toNumber(item?.requests);
    current.promptTokens += toNumber(item?.promptTokens);
    current.completionTokens += toNumber(item?.completionTokens);
    current.cachedTokens += toNumber(item?.cachedTokens);
    current.cost += toNumber(item?.cost);
    current.totalTokens = current.promptTokens + current.completionTokens;
    current.lastUsed = getLatestTime(current.lastUsed, item?.lastUsed);

    if (!current.apiKeyMasked && item?.apiKeyMasked) {
      current.apiKeyMasked = item.apiKeyMasked;
    }

    grouped.set(keyName, current);
  }

  return [...grouped.values()]
    .filter((row) => row.cost > 0 || row.totalTokens > 0 || row.requests > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export function formatCompactNumber(value) {
  const n = toNumber(value);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return new Intl.NumberFormat().format(n);
}

export function formatCost(value) {
  return `$${toNumber(value).toFixed(4)}`;
}

export function formatLastUsed(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}
