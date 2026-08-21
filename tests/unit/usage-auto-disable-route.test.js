import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getUsageForProvider: vi.fn(),
  getExecutor: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: mocks.getUsageForProvider,
}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: mocks.getExecutor,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

describe("usage quota auto-disable route", () => {
  let GET;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getExecutor.mockReturnValue({ needsRefresh: () => false });
    ({ GET } = await import("@/app/api/usage/[connectionId]/route.js"));
  });

  it("disables an active connection when its primary quota reaches 5%", async () => {
    const connection = {
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      isActive: true,
      accessToken: "access-token",
      providerSpecificData: { chatgptAccountId: "acct-1" },
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getUsageForProvider.mockResolvedValue({
      quotas: {
        session: { remaining: 5, used: 95, total: 100 },
        weekly: { remaining: 100, used: 0, total: 100 },
      },
    });

    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ quotaStateChanged: true });
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({
        isActive: false,
        providerSpecificData: expect.objectContaining({
          chatgptAccountId: "acct-1",
          quotaAutoDisabled: true,
          quotaAutoDisabledQuota: "session",
          quotaAutoDisabledRemaining: 5,
        }),
      }),
    );
  });

  it("re-enables only a connection previously auto-disabled by quota", async () => {
    const connection = {
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      isActive: false,
      accessToken: "access-token",
      providerSpecificData: {
        quotaAutoDisabled: true,
        quotaAutoDisabledQuota: "session",
        quotaAutoDisabledRemaining: 0,
        chatgptAccountId: "acct-1",
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
    expect(await response.json()).toMatchObject({ quotaStateChanged: true });
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({
        isActive: true,
        providerSpecificData: { chatgptAccountId: "acct-1" },
      }),
    );
  });

  it("does not re-enable a manually disabled connection", async () => {
    const connection = {
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      isActive: false,
      accessToken: "access-token",
      providerSpecificData: { chatgptAccountId: "acct-1" },
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

  it("does not change state for a provider message without quota data", async () => {
    const connection = {
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      isActive: true,
      accessToken: "access-token",
      providerSpecificData: {},
    };
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getUsageForProvider.mockResolvedValue({ message: "Usage temporarily unavailable" });

    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: "Usage temporarily unavailable",
      quotaStateChanged: false,
    });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
