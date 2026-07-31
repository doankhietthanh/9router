import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-usage-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  const driver = await import("@/lib/db/driver.js");
  adapter = await driver.getAdapter();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Usage by API Key stats", () => {
  it("keeps distinct 24h API keys separate when their masked prefixes collide", async () => {
    const apiKeyA = "sk-test-sameprefix-alpha";
    const apiKeyB = "sk-test-sameprefix-beta";

    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ["key-a", apiKeyA, "Alpha key", "machine", 1, new Date().toISOString()]
    );
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ["key-b", apiKeyB, "Beta key", "machine", 1, new Date().toISOString()]
    );

    await db.saveRequestUsage({
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      provider: "openai",
      model: "gpt-4o",
      apiKey: apiKeyA,
      tokens: { prompt_tokens: 10, completion_tokens: 1 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });
    await db.saveRequestUsage({
      timestamp: new Date(Date.now() - 30_000).toISOString(),
      provider: "openai",
      model: "gpt-4o",
      apiKey: apiKeyB,
      tokens: { prompt_tokens: 20, completion_tokens: 2 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const stats = await db.getUsageStats("24h");
    const entries = Object.entries(stats.byApiKey);

    expect(entries).toHaveLength(2);
    expect(entries.map(([, entry]) => entry.keyName).sort()).toEqual(["Alpha key", "Beta key"]);
    expect(entries.map(([, entry]) => entry.requests).sort()).toEqual([1, 1]);
    expect(entries.some(([key]) => key.includes(apiKeyA) || key.includes(apiKeyB))).toBe(false);
  });
});
