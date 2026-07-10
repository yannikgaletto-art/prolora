#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProloraClient } from './api-client.js';
import { registerPublishingTools } from './tools/publishing.js';
import { registerListeningTools } from './tools/listening.js';
import { registerDiscoveryTools } from './tools/discovery.js';

// Constructing the client validates PROLORA_API_KEY is set — fails fast
// with a clear message and non-zero exit before the server ever connects.
let client: ProloraClient;
try {
  client = new ProloraClient();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Failed to start Prolora MCP server.');
  process.exit(1);
}

const server = new McpServer({
  name: 'prolora',
  version: '1.0.0',
  description: 'Prolora — Publishing API + Feedback Aggregation + Discovery Intelligence',
});

registerPublishingTools(server, client);
registerListeningTools(server, client);
registerDiscoveryTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
