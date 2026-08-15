import { randomUUID } from "node:crypto";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpManager } from "./manager.js";

const app = express(); app.use(express.json({ limit: "2mb" }));
const manager = new McpManager(); await manager.init();
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

function publicState() { return { servers: manager.list().map(({ env, headers, ...s }) => ({ ...s, hasSecrets: Boolean(env || headers) })) }; }
app.get("/api/state", (_req, res) => res.json(publicState()));
app.post("/api/import", async (req, res) => { try { res.json({ added: await manager.import(req.body), ...publicState() }); } catch (e) { res.status(400).json({ error: message(e) }); } });
app.post("/api/servers/:id/enabled", async (req, res) => { try { await manager.setServerEnabled(req.params.id, Boolean(req.body.enabled)); res.json(publicState()); } catch (e) { res.status(400).json({ error: message(e) }); } });
app.post("/api/servers/:id/restart", async (req, res) => { try { await manager.connect(req.params.id); res.json(publicState()); } catch (e) { res.status(400).json({ error: message(e) }); } });
app.delete("/api/servers/:id", async (req, res) => { try { await manager.remove(req.params.id); res.json(publicState()); } catch (e) { res.status(400).json({ error: message(e) }); } });
app.post("/api/servers/:id/tools", async (req, res) => { try { await manager.setAllTools(req.params.id, Boolean(req.body.enabled)); res.json(publicState()); } catch (e) { res.status(400).json({ error: message(e) }); } });
app.post("/api/servers/:id/tools/:name", async (req, res) => { try { await manager.setToolEnabled(req.params.id, req.params.name, Boolean(req.body.enabled)); res.json(publicState()); } catch (e) { res.status(400).json({ error: message(e) }); } });

function makeRouter() {
  const server = new Server({ name: "mcp-hub-router", version: "0.1.0" }, { capabilities: { tools: { listChanged: true } }, instructions: "Tools are namespaced as server-id.tool-name and filtered by user permissions." });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: manager.availableTools() }));
  server.setRequestHandler(CallToolRequestSchema, async req => await manager.call(req.params.name, req.params.arguments ?? {}) as any);
  return server;
}
manager.onChange(() => { for (const { server } of sessions.values()) server.sendToolListChanged().catch(() => {}); });

app.post("/mcp", async (req, res) => {
  try {
    const sid = req.header("mcp-session-id"); let session = sid ? sessions.get(sid) : undefined;
    if (!session && !sid && isInitializeRequest(req.body)) {
      const server = makeRouter(); let transport!: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: id => { sessions.set(id, { transport, server }); } });
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await server.connect(transport); session = { transport, server };
    }
    if (!session) return void res.status(400).json({ error: "Invalid or missing MCP session" });
    await session.transport.handleRequest(req, res, req.body);
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: message(e) }); }
});
for (const method of ["get", "delete"] as const) app[method]("/mcp", async (req, res) => { const s = sessions.get(String(req.header("mcp-session-id"))); if (!s) return void res.status(400).send("Invalid MCP session"); await s.transport.handleRequest(req, res); });
const moduleDir = dirname(fileURLToPath(import.meta.url));
app.use(express.static(resolve(moduleDir, "../dist-ui")));
app.listen(7331, "127.0.0.1", () => console.log("MCP Hub: http://127.0.0.1:7331"));
function message(e: unknown) { return e instanceof Error ? e.message : String(e); }
