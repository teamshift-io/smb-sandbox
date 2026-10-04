import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generate, toJSON } from "../src/index.js";
import { formatSummary } from "../src/summary.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

// Exercises the built binary; run `pnpm build` first (the package test script does not build).
describe.skipIf(!existsSync(cli))("cli (dist)", () => {
  it("--summary matches the library summary", () => {
    const r = run("--industry", "dental-clinic", "--seed", "7", "--summary");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(formatSummary(generate({ industry: "dental-clinic", seed: 7 })));
  });

  it("prints byte-identical JSON to stdout by default", () => {
    const a = run("--seed", "42");
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(toJSON(generate({ industry: "home-services", seed: 42 })));
    expect(run("--seed", "42").stdout).toBe(a.stdout);
  });

  it("writes directory formats as multiple files", () => {
    const dir = mkdtempSync(join(tmpdir(), "fake-business-"));
    try {
      const r = run("--industry", "marketing-agency", "--format", "hubspot", "--out", dir);
      expect(r.status).toBe(0);
      expect(readdirSync(dir).sort()).toEqual(["companies.csv", "contacts.csv", "deals.csv"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists industries, shows help and rejects bad input", () => {
    expect(run("--list-industries").stdout).toContain("dental-clinic");
    expect(run("--help").stdout).toContain("--messiness");
    const bad = run("--industry", "bakery");
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("Unknown --industry");
    expect(run("--size", "huge").status).toBe(2);
    expect(run("--format", "xml").status).toBe(2);
  });
});
