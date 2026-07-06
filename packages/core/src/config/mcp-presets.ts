import type { McpPreset } from "@kako/shared";

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "custom",
    label: "自定义",
    title: "my-mcp-server",
    displayName: "",
    config: {
      type: "stdio",
      command: "uvx",
      args: [],
    },
  },
  {
    id: "fetch",
    label: "fetch",
    title: "fetch",
    displayName: "@modelcontextprotocol/server-fetch",
    config: {
      type: "stdio",
      command: "uvx",
      args: ["mcp-server-fetch"],
    },
  },
  {
    id: "time",
    label: "time",
    title: "time",
    displayName: "@modelcontextprotocol/server-time",
    config: {
      type: "stdio",
      command: "uvx",
      args: ["mcp-server-time"],
    },
  },
  {
    id: "memory",
    label: "memory",
    title: "memory",
    displayName: "@modelcontextprotocol/server-memory",
    config: {
      type: "stdio",
      command: "uvx",
      args: ["mcp-server-memory"],
    },
  },
  {
    id: "sequential-thinking",
    label: "sequential-thinking",
    title: "sequential-thinking",
    displayName: "@modelcontextprotocol/server-sequential-thinking",
    config: {
      type: "stdio",
      command: "uvx",
      args: ["mcp-server-sequential-thinking"],
    },
  },
  {
    id: "context7",
    label: "context7",
    title: "context7",
    displayName: "Context7 MCP",
    config: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    },
  },
];
