#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Dataset, GenerateOptions, IndustryId } from "@teamshift/fake-business";
import { buildStateFile, createSandboxServer, TOOLSETS, type SandboxServerOptions, type Toolset } from "./server.js";
import { SandboxStore } from "./store.js";
import { VERSION } from "./version.js";

const HELP = `sandbox-mcp ${VERSION} — mock small-business MCP servers over a fictional company.

Usage: sandbox-mcp [options]

Data:
  --industry <id>        home-services | dental-clinic | marketing-agency (default home-services)
  --seed <n>             Generator seed (default 42)
  --size <s>             small | medium | large (default medium)
  --messiness <x>        Anomaly multiplier, 0 disables (default 1)
  --data <file>          Load a Dataset JSON instead of generating one

Server:
  --toolsets <list>      Comma list of ${TOOLSETS.join(",")} (default all)
  --expose-answers       Expose ground-truth anomalies as sandbox://anomalies
  --state-out <file>     Write dataset + audit log + outbox JSON on exit and on admin_save_state
  --http <port>          Serve Streamable HTTP on 127.0.0.1:<port>/mcp instead of stdio
  -h, --help             Show this help
  -v, --version          Show version

Nothing leaves the process: email/SMS are written to an outbox. Logs go to stderr.`;

const log = (msg: string): void => {
  process.stderr.write(`[sandbox-mcp] ${msg}\n`);
};

function die(msg: string): never {
  log(`error: ${msg}`);
  process.exit(2);
}

async function loadDataset(values: Record<string, string | boolean | undefined>): Promise<Dataset> {
  if (typeof values.data === "string") {
    const file = resolve(values.data);
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Dataset;
    } catch (err) {
      die(`could not read dataset ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const industry = (values.industry as string | undefined) ?? "home-services";
  if (!["home-services", "dental-clinic", "marketing-agency"].includes(industry)) die(`unknown --industry "${industry}"`);
  const seed = Number(values.seed ?? 42);
  if (!Number.isInteger(seed)) die("--seed must be an integer");
  const opts: GenerateOptions = { industry: industry as IndustryId, seed };
  if (values.size !== undefined) {
    if (!["small", "medium", "large"].includes(values.size as string)) die("--size must be small, medium or large");
    opts.size = values.size as GenerateOptions["size"];
  }
  if (values.messiness !== undefined) {
    const m = Number(values.messiness);
    if (!Number.isFinite(m) || m < 0) die("--messiness must be a non-negative number");
    opts.messiness = m;
  }
  const { generate } = await import("@teamshift/fake-business");
  return generate(opts);
}

function parseToolsets(raw: string | undefined): Toolset[] {
  if (!raw) return [...TOOLSETS];
  const sets = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of sets) if (!(TOOLSETS as readonly string[]).includes(s)) die(`unknown toolset "${s}" (valid: ${TOOLSETS.join(", ")})`);
  return sets as Toolset[];
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      industry: { type: "string" },
      seed: { type: "string" },
      size: { type: "string" },
      messiness: { type: "string" },
      data: { type: "string" },
      toolsets: { type: "string" },
      "expose-answers": { type: "boolean" },
      "state-out": { type: "string" },
      http: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const dataset = await loadDataset(values);
  const store = new SandboxStore(dataset);
  const stateOut = values["state-out"] ? resolve(values["state-out"]) : null;
  const saveState = stateOut
    ? (): string => {
        writeFileSync(stateOut, JSON.stringify(buildStateFile(store), null, 2));
        return stateOut;
      }
    : undefined;
  const serverOptions: SandboxServerOptions = {
    toolsets: parseToolsets(values.toolsets),
    exposeAnswers: values["expose-answers"] === true,
    saveState,
  };

  let saved = false;
  const shutdown = (code: number): void => {
    if (saveState && !saved) {
      saved = true;
      try {
        log(`state written to ${saveState()}`);
      } catch (err) {
        log(`failed to write state: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  const company = store.getCompany();
  log(`${company.name} (${dataset.meta.industry}, seed ${dataset.meta.seed}); toolsets: ${serverOptions.toolsets!.join(",")}; simulated now ${store.now()}`);

  if (values.http !== undefined) {
    const port = Number(values.http);
    if (!Number.isInteger(port) || port < 0 || port > 65535) die("--http must be a port number");
    const http = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      // DNS-rebinding guard: only accept loopback Host headers.
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
        res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "Forbidden host" }));
        return;
      }
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not found; MCP endpoint is /mcp" }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json", allow: "POST" }).end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server; use POST)." }, id: null }),
        );
        return;
      }
      // Stateless: a fresh MCP server per request, all sharing one store.
      const server = createSandboxServer(store, serverOptions);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        const body = await readJsonBody(req);
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (err) {
        log(`http error: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) {
          res.writeHead(400, { "content-type": "application/json" }).end(
            JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Invalid request body" }, id: null }),
          );
        }
      }
    });
    http.listen(port, "127.0.0.1", () => {
      const addr = http.address();
      log(`listening on http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}/mcp`);
    });
    return;
  }

  const server = createSandboxServer(store, serverOptions);
  const transport = new StdioServerTransport();
  transport.onclose = () => shutdown(0);
  process.stdin.on("end", () => shutdown(0));
  await server.connect(transport);
  log("ready on stdio");
}

main().catch((err: unknown) => {
  log(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
