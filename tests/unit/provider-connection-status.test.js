import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  getProxyPoolById: mocks.getProxyPoolById,
  updateProviderConnection: mocks.updateProviderConnection,
  deleteProviderConnection: mocks.deleteProviderConnection,
}));

describe("provider connection manual status changes", () => {
  let PUT;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getProxyPoolById.mockResolvedValue(null);
    mocks.updateProviderConnection.mockImplementation(async (id, data) => ({ id, ...data }));
    ({ PUT } = await import("@/app/api/providers/[id]/route.js"));
  });

  it("clears quota auto-disable metadata for an explicit isActive update", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "codex",
      providerSpecificData: {
        chatgptAccountId: "acct-1",
        quotaAutoDisabled: true,
        quotaAutoDisabledAt: "2026-08-17T00:00:00.000Z",
        quotaAutoDisabledQuota: "session",
        quotaAutoDisabledRemaining: 0,
      },
    });

    const response = await PUT(
      new Request("http://localhost/api/providers/conn-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ id: "conn-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-1", {
      isActive: false,
      providerSpecificData: { chatgptAccountId: "acct-1" },
    });
  });

  it("preserves quota auto-disable metadata for unrelated updates", async () => {
    const providerSpecificData = {
      chatgptAccountId: "acct-1",
      quotaAutoDisabled: true,
      quotaAutoDisabledQuota: "session",
    };
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "codex",
      name: "Old name",
      providerSpecificData,
    });

    const response = await PUT(
      new Request("http://localhost/api/providers/conn-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New name" }),
      }),
      { params: Promise.resolve({ id: "conn-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-1", {
      name: "New name",
      providerSpecificData,
    });
  });

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
});
