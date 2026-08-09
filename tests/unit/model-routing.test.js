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

  it("includes model routes in database export and import", async () => {
    const { upsertModelRoute } = await import("@/lib/db/repos/modelRoutesRepo.js");
    const { exportDb, importDb } = await import("@/lib/db/index.js");

    await upsertModelRoute("gpt-5.6-sol", ["a", "b"]);
    const exported = await exportDb();
    expect(exported.modelRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "gpt-5.6-sol", connectionIds: ["a", "b"] }),
    ]));

    await importDb({ modelRoutes: [{ model: "gpt-5.6-lunna", connectionIds: ["c"], isActive: true }] });
    const { getModelRouteByModel } = await import("@/lib/db/repos/modelRoutesRepo.js");
    expect(await getModelRouteByModel("gpt-5.6-sol")).toBeNull();
    expect(await getModelRouteByModel("gpt-5.6-lunna")).toEqual(expect.objectContaining({
      connectionIds: ["c"],
      isActive: true,
    }));
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

  it("looks up a prefixed route key before the legacy bare model key", async () => {
    const getModelRouteByModel = vi.fn(async (key) => (
      key === "cx/gpt-5.6-luna"
        ? { model: key, connectionIds: ["codex-1"], isActive: true }
        : null
    ));
    vi.doMock("@/lib/localDb", () => ({
      getModelRouteByModel,
      getProviderConnectionById: vi.fn(async () => ({ id: "codex-1", provider: "codex", isActive: true })),
    }));
    const { resolveModelConnectionRoute } = await import("@/sse/services/modelRouting.js");

    await expect(resolveModelConnectionRoute({
      provider: "codex",
      model: "gpt-5.6-luna",
      modelKey: "cx/gpt-5.6-luna",
    })).resolves.toEqual({ hasRule: true, connectionIds: ["codex-1"], invalidConnectionIds: [] });
    expect(getModelRouteByModel).toHaveBeenCalledWith("cx/gpt-5.6-luna");
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

describe("model route management API", () => {
  it("creates a route with an inactive connection from the model provider", async () => {
    const upsertModelRoute = vi.fn(async (model, connectionIds, isActive) => ({
      model,
      connectionIds,
      isActive,
    }));
    vi.doMock("@/lib/localDb", () => ({
      getModelRoutes: vi.fn(async () => []),
      getModelRouteByModel: vi.fn(async () => null),
      upsertModelRoute,
      getProviderConnections: vi.fn(async () => []),
      getProviderConnectionById: vi.fn(async () => ({
        id: "openai-inactive",
        provider: "openai",
        isActive: false,
      })),
    }));
    vi.doMock("@/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async () => ({ provider: "openai", model: "gpt-5.6-sol" })),
    }));
    const { POST } = await import("@/app/api/model-routing/route.js");
    const response = await POST(new Request("http://localhost/api/model-routing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        connectionIds: ["openai-inactive"],
      }),
    }));

    expect(response.status).toBe(201);
    expect(upsertModelRoute).toHaveBeenCalledWith("gpt-5.6-sol", ["openai-inactive"], true);
  });

  it("rejects a missing connection with an existence-specific error", async () => {
    vi.doMock("@/lib/localDb", () => ({
      getModelRoutes: vi.fn(async () => []),
      getModelRouteByModel: vi.fn(async () => null),
      upsertModelRoute: vi.fn(),
      getProviderConnections: vi.fn(async () => []),
      getProviderConnectionById: vi.fn(async () => null),
    }));
    vi.doMock("@/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async () => ({ provider: "openai", model: "gpt-5.6-sol" })),
    }));
    const { POST } = await import("@/app/api/model-routing/route.js");
    const response = await POST(new Request("http://localhost/api/model-routing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", connectionIds: ["missing"] }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "All selected connections must exist",
    });
  });

  it("rejects a connection from a different provider", async () => {
    vi.doMock("@/lib/localDb", () => ({
      getModelRoutes: vi.fn(async () => []),
      getModelRouteByModel: vi.fn(async () => null),
      upsertModelRoute: vi.fn(),
      getProviderConnectionById: vi.fn(async () => ({ id: "anthropic-1", provider: "anthropic", isActive: true })),
      getProviderConnections: vi.fn(async () => [
        { id: "anthropic-1", provider: "anthropic", isActive: true },
      ]),
    }));
    vi.doMock("@/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async () => ({ provider: "openai", model: "gpt-5.6-sol" })),
    }));
    const { POST } = await import("@/app/api/model-routing/route.js");
    const response = await POST(new Request("http://localhost/api/model-routing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", connectionIds: ["anthropic-1"] }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Selected connections must match the model provider",
    });
  });

  it("does not expose credentials in GET responses", async () => {
    vi.doMock("@/lib/localDb", () => ({
      getModelRoutes: vi.fn(async () => [{
        model: "gpt-5.6-sol",
        connectionIds: ["openai-1"],
        isActive: true,
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
      }]),
      getProviderConnections: vi.fn(async () => [{
        id: "openai-1",
        provider: "openai",
        name: "Account A",
        apiKey: "secret",
        accessToken: "secret-token",
        isActive: true,
      }]),
    }));
    const { GET } = await import("@/app/api/model-routing/route.js");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.routes[0].connections[0]).toEqual({
      id: "openai-1",
      provider: "openai",
      name: "Account A",
      email: null,
      isActive: true,
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("preserves the provider prefix when creating an exact route", async () => {
    const upsertModelRoute = vi.fn(async (model, connectionIds) => ({
      model,
      connectionIds,
      isActive: true,
    }));
    vi.doMock("@/lib/localDb", () => ({
      getModelRouteByModel: vi.fn(async () => null),
      upsertModelRoute,
      getProviderConnectionById: vi.fn(async () => ({ id: "codex-1", provider: "codex", isActive: true })),
      getProviderConnections: vi.fn(async () => []),
    }));
    vi.doMock("@/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async () => ({ provider: "codex", model: "gpt-5.6-luna" })),
    }));
    const { POST } = await import("@/app/api/model-routing/route.js");
    const response = await POST(new Request("http://localhost/api/model-routing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "cx/gpt-5.6-luna", connectionIds: ["codex-1"] }),
    }));

    expect(response.status).toBe(201);
    expect(upsertModelRoute).toHaveBeenCalledWith("cx/gpt-5.6-luna", ["codex-1"], true);
  });

  it("updates a route with an inactive connection from the model provider", async () => {
    const upsertModelRoute = vi.fn(async (model, connectionIds, isActive) => ({
      model,
      connectionIds,
      isActive,
    }));
    vi.doMock("@/lib/localDb", () => ({
      getModelRouteByModel: vi.fn(async () => ({
        model: "gpt-5.6-sol",
        connectionIds: ["openai-active"],
        isActive: true,
      })),
      upsertModelRoute,
      deleteModelRoute: vi.fn(),
      getProviderConnections: vi.fn(async () => [
        { id: "openai-active", provider: "openai", isActive: true },
        { id: "openai-inactive", provider: "openai", isActive: false },
      ]),
    }));
    vi.doMock("@/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async () => ({ provider: "openai", model: "gpt-5.6-sol" })),
    }));
    const { PUT } = await import("@/app/api/model-routing/[model]/route.js");
    const response = await PUT(new Request("http://localhost/api/model-routing/gpt-5.6-sol", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionIds: ["openai-inactive"], isActive: true }),
    }), { params: Promise.resolve({ model: "gpt-5.6-sol" }) });

    expect(response.status).toBe(200);
    expect(upsertModelRoute).toHaveBeenCalledWith("gpt-5.6-sol", ["openai-inactive"], true);
  });

  it("edits a legacy bare route using the provider of its saved connection", async () => {
    const upsertModelRoute = vi.fn(async (model, connectionIds, isActive) => ({ model, connectionIds, isActive }));
    vi.doMock("@/lib/localDb", () => ({
      getModelRouteByModel: vi.fn(async () => ({ model: "gpt-5.6-luna", connectionIds: ["codex-1"], isActive: true })),
      upsertModelRoute,
      getProviderConnections: vi.fn(async () => [{ id: "codex-1", provider: "codex", isActive: true }]),
    }));
    vi.doMock("@/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async () => ({ provider: "openai", model: "gpt-5.6-luna" })),
    }));
    const { PUT } = await import("@/app/api/model-routing/[model]/route.js");
    const response = await PUT(new Request("http://localhost/api/model-routing/gpt-5.6-luna", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionIds: ["codex-1"], isActive: true }),
    }), { params: Promise.resolve({ model: "gpt-5.6-luna" }) });

    expect(response.status).toBe(200);
    expect(upsertModelRoute).toHaveBeenCalledWith("gpt-5.6-luna", ["codex-1"], true);
  });
});
