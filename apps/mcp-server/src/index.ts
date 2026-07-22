#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProloraClient } from './api-client.js';
import { registerPublishingTools } from './tools/publishing.js';
import { registerListeningTools } from './tools/listening.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerContentTools } from './tools/content.js';

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
  version: '1.1.0',
  description: 'Prolora — Publishing API + Kalender + Content-Flywheel + Feedback + Discovery',
});

registerPublishingTools(server, client);
registerListeningTools(server, client);
registerDiscoveryTools(server, client);
registerContentTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);

// Non-blocking reachability ping AFTER connect — stderr only (stdout is the
// MCP protocol channel). A dead base URL should surface at startup, not as a
// cryptic timeout on the first tool call.
void client.ping().then((reachable) => {
  if (!reachable) {
    const hint = client.usesDefaultBaseUrl
      ? ' Es ist keine PROLORA_BASE_URL gesetzt — setze sie auf deine Prolora-Instanz (z. B. http://localhost:3000/api/v1).'
      : '';
    console.error(
      `[prolora-mcp] Warnung: Prolora-API unter ${client.baseUrlForDisplay} nicht erreichbar.${hint}`
    );
  }
});
