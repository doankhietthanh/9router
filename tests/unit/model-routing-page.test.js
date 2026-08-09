import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/model-routing/page.js", import.meta.url),
  "utf8"
);

describe("model routing account picker", () => {
  it("keeps inactive accounts in the selectable connection list", () => {
    expect(pageSource).not.toContain(
      ".filter((connection) => connection.isActive !== false)"
    );
    expect(pageSource).toContain(
      "setConnections(connectionsData.connections || [])"
    );
  });

  it("labels inactive account options and uses a general empty state", () => {
    expect(pageSource).toContain("Inactive account");
    expect(pageSource).toContain("No accounts available.");
    expect(pageSource).not.toContain("No active accounts available.");
  });
});
