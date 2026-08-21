import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  backfillCodexEmails: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/lib/oauth/providers", () => ({
  backfillCodexEmails: mocks.backfillCodexEmails,
}));

describe("provider client route", () => {
  let GET;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.backfillCodexEmails.mockResolvedValue(undefined);
    ({ GET } = await import("@/app/api/providers/client/route.js"));
  });

  it("preserves the quota auto-disable setting for the dashboard", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "antigravity",
        authType: "oauth",
        isActive: true,
        providerSpecificData: {
          quotaAutoDisableEnabled: false,
          accessToken: "secret-token",
        },
      },
    ]);

    const response = await GET(new Request("http://localhost/api/providers/client"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connections: [
        {
          id: "conn-1",
          providerSpecificData: { quotaAutoDisableEnabled: false },
        },
      ],
    });
  });
});
