import { describe, expect, it } from "vitest";
import { buildApiKeyCostRows } from "@/app/(dashboard)/dashboard/usage/components/apiKeyCostData.js";

describe("buildApiKeyCostRows", () => {
  it("groups API key stats by display name and sorts by estimated cost", () => {
    const rows = buildApiKeyCostRows({
      "api-key:a|gpt-4.1|openai": {
        keyName: "Production",
        apiKeyMasked: "sk-prod***",
        requests: 4,
        promptTokens: 100,
        completionTokens: 40,
        cachedTokens: 10,
        cost: 2.5,
        lastUsed: "2026-07-31T09:00:00.000Z",
      },
      "api-key:a|gpt-4.1-mini|openai": {
        keyName: "Production",
        apiKeyMasked: "sk-prod***",
        requests: 6,
        promptTokens: 200,
        completionTokens: 60,
        cachedTokens: 20,
        cost: 1.25,
        lastUsed: "2026-07-31T10:00:00.000Z",
      },
      "api-key:b|claude-sonnet-4|claude": {
        keyName: "Staging",
        apiKeyMasked: "sk-stage***",
        requests: 2,
        promptTokens: 50,
        completionTokens: 25,
        cachedTokens: 0,
        cost: 4.1,
        lastUsed: "2026-07-31T08:00:00.000Z",
      },
    });

    expect(rows).toEqual([
      {
        id: "Staging",
        keyName: "Staging",
        apiKeyMasked: "sk-stage***",
        requests: 2,
        promptTokens: 50,
        completionTokens: 25,
        cachedTokens: 0,
        totalTokens: 75,
        cost: 4.1,
        lastUsed: "2026-07-31T08:00:00.000Z",
      },
      {
        id: "Production",
        keyName: "Production",
        apiKeyMasked: "sk-prod***",
        requests: 10,
        promptTokens: 300,
        completionTokens: 100,
        cachedTokens: 30,
        totalTokens: 400,
        cost: 3.75,
        lastUsed: "2026-07-31T10:00:00.000Z",
      },
    ]);
  });

  it("falls back to masked key, api key id, unknown label, and applies limit", () => {
    const rows = buildApiKeyCostRows({
      one: { apiKeyMasked: "sk-one***", requests: 1, promptTokens: 1, completionTokens: 2, cost: 1 },
      two: { apiKeyKey: "local-no-key", requests: 1, promptTokens: 2, completionTokens: 2, cost: 3 },
      three: { requests: 1, promptTokens: 10, completionTokens: 0, cost: 2 },
    }, 2);

    expect(rows.map((row) => row.keyName)).toEqual(["Local (No API Key)", "Unknown API Key"]);
    expect(rows.map((row) => row.cost)).toEqual([3, 2]);
  });

  it("returns an empty array for missing or empty stats", () => {
    expect(buildApiKeyCostRows(null)).toEqual([]);
    expect(buildApiKeyCostRows({})).toEqual([]);
  });
});
