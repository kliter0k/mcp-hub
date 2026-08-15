import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type ServerConfig = {
  id: string;
  label: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabledTools: string[];
};

export type ServerView = ServerConfig & {
  status: "stopped" | "connecting" | "running" | "error";
  error?: string;
  tools: (Tool & { enabled: boolean })[];
};

export type PersistedState = { servers: ServerConfig[] };
