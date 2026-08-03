import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-route-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("model route persistence", () => {
  it("creates, reads, updates, and deletes an ordered model route", async () => {
    const {
      getModelRoutes,
      getModelRouteByModel,
      upsertModelRoute,
      deleteModelRoute,
    } = await import("@/lib/db/repos/modelRoutesRepo.js");

    const created = await upsertModelRoute("gpt-5.6-sol", ["a", "b", "a"]);
    expect(created).toMatchObject({
      model: "gpt-5.6-sol",
      connectionIds: ["a", "b"],
      isActive: true,
    });
    expect(await getModelRouteByModel("gpt-5.6-sol")).toEqual(created);

    const updated = await upsertModelRoute("gpt-5.6-sol", ["b", "c"], false);
    expect(updated.connectionIds).toEqual(["b", "c"]);
    expect(updated.isActive).toBe(false);
    expect(await getModelRoutes()).toEqual([updated]);

    expect(await deleteModelRoute("gpt-5.6-sol")).toBe(true);
    expect(await getModelRouteByModel("gpt-5.6-sol")).toBeNull();
    expect(await deleteModelRoute("gpt-5.6-sol")).toBe(false);
  });

  it("rejects empty model and empty active route", async () => {
    const { upsertModelRoute } = await import("@/lib/db/repos/modelRoutesRepo.js");

    await expect(upsertModelRoute("", ["a"])).rejects.toThrow("Model is required");
    await expect(upsertModelRoute("gpt-5.6-sol", [])).rejects.toThrow(
      "At least one connectionId is required for an active route"
    );
  });
});

describe("model route resolution", () => {
  it("returns no rule when the model has no active route", async () => {
    vi.doMock("@/lib/localDb", () => ({
      getModelRouteByModel: vi.fn(async () => null),
      getProviderConnectionById: vi.fn(),
    }));
    const { resolveModelConnectionRoute } = await import("@/sse/services/modelRouting.js");

    await expect(resolveModelConnectionRoute({ provider: "openai", model: "gpt-4" }))
      .resolves.toEqual({ hasRule: false, connectionIds: null, invalidConnectionIds: [] });
  });

  it("keeps only active connections for the resolved provider in configured order", async () => {
    const connections = {
      a: { id: "a", provider: "openai", isActive: true },
      b: { id: "b", provider: "openai", isActive: true },
      c: { id: "c", provider: "anthropic", isActive: true },
      d: { id: "d", provider: "openai", isActive: false },
    };
    vi.doMock("@/lib/localDb", () => ({
      getModelRouteByModel: vi.fn(async () => ({
        model: "gpt-5.6-sol",
        connectionIds: ["b", "a", "c", "d", "missing"],
        isActive: true,
      })),
      getProviderConnectionById: vi.fn(async (id) => connections[id] || null),
    }));
    const { resolveModelConnectionRoute } = await import("@/sse/services/modelRouting.js");

    await expect(resolveModelConnectionRoute({ provider: "openai", model: "gpt-5.6-sol" }))
      .resolves.toEqual({
        hasRule: true,
        connectionIds: ["b", "a"],
        invalidConnectionIds: ["c", "d", "missing"],
      });
  });

  it("keeps an active route even when every configured connection is stale", async () => {
    vi.doMock("@/lib/localDb", () => ({
      getModelRouteByModel: vi.fn(async () => ({
        model: "gpt-5.6-sol",
        connectionIds: ["missing"],
        isActive: true,
      })),
      getProviderConnectionById: vi.fn(async () => null),
    }));
    const { resolveModelConnectionRoute } = await import("@/sse/services/modelRouting.js");

    await expect(resolveModelConnectionRoute({ provider: "openai", model: "gpt-5.6-sol" }))
      .resolves.toEqual({ hasRule: true, connectionIds: [], invalidConnectionIds: ["missing"] });
  });
});

describe("credential selection scope", () => {
  it("never selects a provider connection outside the model allowlist", async () => {
    const connections = [
      { id: "a", provider: "openai", isActive: true, priority: 1, providerSpecificData: {} },
      { id: "b", provider: "openai", isActive: true, priority: 2, providerSpecificData: {} },
      { id: "c", provider: "openai", isActive: true, priority: 3, providerSpecificData: {} },
    ];
    vi.doMock("@/lib/localDb", () => ({
      getProviderConnections: vi.fn(async () => connections),
      getSettings: vi.fn(async () => ({ fallbackStrategy: "fill-first" })),
      getProxyPools: vi.fn(async () => []),
      updateProviderConnection: vi.fn(),
      validateApiKey: vi.fn(),
    }));
    vi.doMock("@/lib/network/connectionProxy", () => ({
      resolveConnectionProxyConfig: vi.fn(async () => ({})),
      pickProxyPoolId: vi.fn(),
    }));
    const { getProviderCredentials } = await import("@/sse/services/auth.js");

    const credentials = await getProviderCredentials("openai", null, "gpt-5.6-sol", {
      allowedConnectionIds: ["a", "b"],
    });

    expect(["a", "b"]).toContain(credentials.connectionId);
    expect(credentials.connectionId).not.toBe("c");
  });
});
