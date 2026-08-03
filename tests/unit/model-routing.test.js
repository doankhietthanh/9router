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
