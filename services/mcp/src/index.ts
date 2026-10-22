#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient } from "./api.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main() {
  const config = loadConfig(process.env);
  await createServer(createApiClient(config)).connect(new StdioServerTransport());
  console.error("hexprocure-mcp ready (read-only, stdio)");
}

main().catch((error: unknown) => {
  console.error(`hexprocure-mcp: ${error instanceof Error ? error.message : "failed to start"}`);
  process.exit(1);
});
