import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createSandboxServer, SandboxStore, type SandboxServerOptions } from "../src/index.js";
import { fixture } from "./fixture.js";

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connect(options: SandboxServerOptions = {}): Promise<{ client: Client; store: SandboxStore }> {
  const store = new SandboxStore(fixture());
  const server = createSandboxServer(store, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return { client, store };
}

function text(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content[0]!.text;
}

describe("MCP server (in-memory transport)", () => {
  it("lists prefixed snake_case tools with annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(40);
    for (const n of ["crm_search_contacts", "crm_update_deal", "inbox_list_threads", "inbox_send_email", "calendar_list_jobs", "calendar_reschedule_job", "invoicing_list_invoices", "invoicing_record_payment", "phone_list_calls", "admin_reset", "admin_get_audit_log", "admin_get_company_policies"]) {
      expect(names).toContain(n);
    }
    for (const t of tools) {
      expect(t.name).toMatch(/^(crm|inbox|calendar|invoicing|phone|admin)_[a-z_]+$/);
      expect(t.description!.length).toBeGreaterThan(20);
      expect(t.annotations?.openWorldHint).toBe(false);
    }
    expect(tools.find((t) => t.name === "crm_search_contacts")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find((t) => t.name === "crm_merge_contacts")!.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
  });

  it("respects --toolsets selection", async () => {
    const { client } = await connect({ toolsets: ["inbox", "phone"] });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.every((n) => n.startsWith("inbox_") || n.startsWith("phone_"))).toBe(true);
    expect(names).toContain("phone_list_calls");
  });

  it("calls read and write tools, then reads the audit log", async () => {
    const { client, store } = await connect();
    const search = await client.callTool({ name: "crm_search_contacts", arguments: { query: "rivera" } });
    expect(search.isError).toBeFalsy();
    expect(JSON.parse(text(search))).toMatchObject({ total: 2 });

    const write = await client.callTool({ name: "crm_update_deal", arguments: { dealId: "deal_000001", nextAction: { summary: "Call Maria", dueOn: "2026-10-01" } } });
    expect(write.isError).toBeFalsy();
    expect(JSON.parse(text(write))).toMatchObject({ id: "deal_000001", nextAction: { summary: "Call Maria", dueOn: "2026-10-01" } });

    const email = await client.callTool({ name: "inbox_send_email", arguments: { threadId: "thr_000001", body: "Thursday works." } });
    expect(JSON.parse(text(email))).toMatchObject({ direction: "outbound", threadId: "thr_000001" });

    const audit = JSON.parse(text(await client.callTool({ name: "admin_get_audit_log", arguments: {} })));
    expect(audit.map((e: { tool: string; result: string }) => [e.tool, e.result])).toEqual([
      ["crm_update_deal", "ok"],
      ["inbox_send_email", "ok"],
    ]);
    expect(store.outbox()).toHaveLength(1);
  });

  it("returns actionable tool errors instead of throwing", async () => {
    const { client } = await connect();
    const bad = await client.callTool({ name: "crm_update_deal", arguments: { dealId: "deal_000002", stage: "won" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/failed_precondition: Cannot move deal from "new" to "won"\. Allowed:/);

    const missing = await client.callTool({ name: "invoicing_record_payment", arguments: { invoiceId: "inv_000003", amountCents: 100, method: "cash" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/void/);

    const schema = await client.callTool({ name: "invoicing_record_payment", arguments: { invoiceId: "inv_000002", amountCents: 1.5, method: "cash" } });
    expect(schema.isError).toBe(true);

    const save = await client.callTool({ name: "admin_save_state", arguments: {} });
    expect(save.isError).toBe(true);
    expect(text(save)).toMatch(/--state-out/);
  });

  it("admin_reset restores state", async () => {
    const { client, store } = await connect();
    const before = store.snapshot();
    await client.callTool({ name: "calendar_cancel_job", arguments: { jobId: "job_000002", reason: "Customer canceled" } });
    expect(store.getJob("job_000002").status).toBe("canceled");
    await client.callTool({ name: "admin_reset", arguments: {} });
    expect(store.snapshot()).toEqual(before);
  });

  it("hides the anomalies resource unless exposeAnswers", async () => {
    const { client } = await connect();
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toEqual(expect.arrayContaining(["sandbox://company", "sandbox://policies"]));
    expect(uris).not.toContain("sandbox://anomalies");
    await expect(client.readResource({ uri: "sandbox://anomalies" })).rejects.toThrow();
    const policies = await client.readResource({ uri: "sandbox://policies" });
    expect(JSON.parse((policies.contents[0] as { text: string }).text)[0].id).toBe("pol_000001");

    const exposed = await connect({ exposeAnswers: true });
    const res = await exposed.client.readResource({ uri: "sandbox://anomalies" });
    expect(JSON.parse((res.contents[0] as { text: string }).text)).toHaveLength(2);
  });
});
