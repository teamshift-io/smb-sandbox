import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { fixture } from "./fixture.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// Spawns the built CLI; run `pnpm build` first (the root `build` precedes `test`).
describe.skipIf(!existsSync(cli))("sandbox-mcp CLI over stdio", () => {
  it("serves a generated trailer dealer through the native MCP contract", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "--industry", "trailer-dealer", "--seed", "42"], stderr: "pipe" });
    const client = new Client({ name: "trailer-cli-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const response = await client.callTool({ name: "invoicing_list_invoices", arguments: {} });
      expect(response.isError).toBeFalsy();
      const invoices = JSON.parse((response.content as Array<{ text: string }>)[0]!.text).items;
      expect(invoices.length).toBeGreaterThan(0);
      expect(JSON.stringify(invoices)).toMatch(/trailer|hitch|brake/i);
    } finally {
      await client.close();
    }
  });

  it("serves tools, applies writes and saves state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-mcp-"));
    const data = join(dir, "dataset.json");
    const out = join(dir, "state.json");
    writeFileSync(data, JSON.stringify(fixture()));

    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "--data", data, "--state-out", out], stderr: "pipe" });
    const client = new Client({ name: "cli-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(40);
      const read = await client.callTool({ name: "invoicing_list_invoices", arguments: { overdue: true } });
      expect(JSON.parse((read.content as Array<{ text: string }>)[0]!.text).items[0].id).toBe("inv_000002");
      const write = await client.callTool({ name: "invoicing_match_payment", arguments: { paymentId: "pay_000002", invoiceId: "inv_000002" } });
      expect(write.isError).toBeFalsy();
      const saved = await client.callTool({ name: "admin_save_state", arguments: {} });
      expect(saved.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    const state = JSON.parse(readFileSync(out, "utf8"));
    expect(state.audit).toEqual([expect.objectContaining({ seq: 1, tool: "invoicing_match_payment", result: "ok" })]);
    expect(state.dataset.payments.find((p: { id: string }) => p.id === "pay_000002").invoiceId).toBe("inv_000002");
    expect(state.outbox).toEqual([]);
  });
});
