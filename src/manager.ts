import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { PersistedState, ServerConfig, ServerView } from "./types.js";

type Runtime = { client?: Client; status: ServerView["status"]; error?: string; tools: Tool[] };

export class McpManager {
  private state: PersistedState = { servers: [] };
  private runtimes = new Map<string, Runtime>();
  private listeners = new Set<() => void>();
  constructor(private statePath = process.env.MCP_HUB_STATE_PATH || resolve("data/state.json")) {}

  async init() {
    try { this.state = JSON.parse(await readFile(this.statePath, "utf8")); } catch { await this.save(); }
    await Promise.allSettled(this.state.servers.filter(s => s.enabled).map(s => this.connect(s.id)));
  }
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed() { for (const fn of this.listeners) fn(); }
  private async save() { await mkdir(dirname(this.statePath), { recursive: true }); await writeFile(this.statePath, JSON.stringify(this.state, null, 2)); }
  list(): ServerView[] {
    return this.state.servers.map(s => {
      const r = this.runtimes.get(s.id) ?? { status: "stopped" as const, tools: [] };
      return { ...s, status: r.status, error: r.error, tools: r.tools.map(t => ({ ...t, enabled: !s.disabledTools.includes(t.name) })) };
    });
  }
  availableTools(): Tool[] {
    return this.list().filter(s => s.enabled && s.status === "running").flatMap(s =>
      s.tools.filter(t => t.enabled).map(({ enabled: _enabled, ...t }) => ({ ...t, name: `${s.id}.${t.name}` }))
    );
  }
  async import(input: unknown) {
    const root = input as Record<string, unknown>;
    const entries = (root?.mcpServers && typeof root.mcpServers === "object" ? root.mcpServers : root) as Record<string, any>;
    if (!entries || Array.isArray(entries)) throw new Error("Ожидался объект MCP-конфигурации");
    const added: string[] = [];
    for (const [rawId, value] of Object.entries(entries)) {
      if (!value || typeof value !== "object" || (!value.command && !value.url)) throw new Error(`Сервер ${rawId}: нужен command или url`);

      const args = Array.isArray(value.args) ? value.args.map(String) : [];
      const env = value.env && typeof value.env === "object" ? Object.fromEntries(Object.entries(value.env).map(([k, v]) => [String(k), String(v)])) : undefined;
      const cwd = typeof value.cwd === "string" ? value.cwd : undefined;
      const headers = value.headers && typeof value.headers === "object" ? Object.fromEntries(Object.entries(value.headers).map(([k, v]) => [String(k), String(v)])) : undefined;

      const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "-");
      const config: ServerConfig = {
        id,
        label: typeof value.label === "string" ? value.label : rawId,
        enabled: typeof value.enabled === "boolean" ? value.enabled : true,
        command: typeof value.command === "string" ? value.command : undefined,
        args,
        env,
        cwd,
        url: typeof value.url === "string" ? value.url : undefined,
        headers,
        disabledTools: Array.isArray(value.disabledTools) ? value.disabledTools.map(String) : []
      };
      const index = this.state.servers.findIndex(s => s.id === id);
      if (index >= 0) this.state.servers[index] = { ...config, disabledTools: this.state.servers[index].disabledTools };
      else this.state.servers.push(config);
      added.push(id);
    }
    await this.save();
    await Promise.allSettled(added.map(id => this.connect(id)));
    this.changed();
    return added;
  }
  async connect(id: string) {
    const cfg = this.requireConfig(id);
    await this.disconnect(id, false);
    this.runtimes.set(id, { status: "connecting", tools: [] }); this.changed();
    try {
      const client = new Client({ name: "mcp-hub", version: "0.1.0" });
      const transport = cfg.url
        ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })
        : new StdioClientTransport({ command: cfg.command!, args: cfg.args, cwd: cfg.cwd, env: { ...process.env, ...cfg.env } as Record<string, string>, stderr: "pipe" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      this.runtimes.set(id, { client, status: "running", tools });
    } catch (e) {
      this.runtimes.set(id, { status: "error", error: e instanceof Error ? e.message : String(e), tools: [] });
    }
    this.changed();
  }
  async disconnect(id: string, notify = true) {
    const r = this.runtimes.get(id); if (r?.client) await r.client.close().catch(() => {});
    this.runtimes.set(id, { status: "stopped", tools: [] }); if (notify) this.changed();
  }
  async setServerEnabled(id: string, enabled: boolean) {
    const cfg = this.requireConfig(id); cfg.enabled = enabled; await this.save();
    if (enabled) await this.connect(id); else await this.disconnect(id); this.changed();
  }
  async remove(id: string) {
    this.requireConfig(id);
    await this.disconnect(id, false);
    this.state.servers = this.state.servers.filter(s => s.id !== id);
    this.runtimes.delete(id);
    await this.save();
    this.changed();
  }
  async setToolEnabled(id: string, name: string, enabled: boolean) {
    const cfg = this.requireConfig(id);
    cfg.disabledTools = enabled ? cfg.disabledTools.filter(n => n !== name) : [...new Set([...cfg.disabledTools, name])];
    await this.save(); this.changed();
  }
  async setAllTools(id: string, enabled: boolean) {
    const cfg = this.requireConfig(id); const tools = this.runtimes.get(id)?.tools ?? [];
    cfg.disabledTools = enabled ? [] : tools.map(t => t.name); await this.save(); this.changed();
  }
  async call(qualifiedName: string, args: Record<string, unknown>) {
    const dot = qualifiedName.indexOf("."); if (dot < 1) throw new Error("Некорректное имя инструмента");
    const id = qualifiedName.slice(0, dot), name = qualifiedName.slice(dot + 1); const cfg = this.requireConfig(id); const r = this.runtimes.get(id);
    if (!cfg.enabled || cfg.disabledTools.includes(name)) throw new Error("Инструмент отключён пользователем");
    if (!r?.client || r.status !== "running" || !r.tools.some(t => t.name === name)) throw new Error("MCP-сервер или инструмент недоступен");
    return r.client.callTool({ name, arguments: args });
  }
  private requireConfig(id: string) { const cfg = this.state.servers.find(s => s.id === id); if (!cfg) throw new Error("MCP-сервер не найден"); return cfg; }
}
