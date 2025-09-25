#!/usr/bin/env node

import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { readFileSync } from "fs";
import { join } from "path";

// Load environment variables
config();

// Load OpenAPI specifications
const loadOpenApiSpecs = () => {
  const specs = [];
  try {
    const gatewaySpec = JSON.parse(
      readFileSync(join(process.cwd(), "openapi", "aap-gateway-api_25.json"), "utf8")
    );
    specs.push(gatewaySpec);
  } catch (error) {
    console.error("Error loading gateway OpenAPI spec:", error);
  }

  try {
    const controllerSpec = JSON.parse(
      readFileSync(join(process.cwd(), "openapi", "aap-controller-api_26-devel.json"), "utf8")
    );
    specs.push(controllerSpec);
  } catch (error) {
    console.error("Error loading controller OpenAPI spec:", error);
  }

  return specs;
};

// Generate tools from OpenAPI specs
const generateTools = async () => {
  const openApiSpecs = loadOpenApiSpecs();
  let allTools: any[] = [];

  for (const spec of openApiSpecs) {
    try {
      const tools = await getToolsFromOpenApi(spec, {
        baseUrl: "http://localhost:44926",
        filterFn: (tool) => {
          return tool.method.toLowerCase() === 'get';
        },
      });
      const shorterTools = tools.filter((tool) => {tool.description = tool.description.split('## Results\n')[0]; return tool;});
      console.log(shorterTools);
      allTools = allTools.concat(shorterTools);
    } catch (error) {
      console.error("Error generating tools from OpenAPI spec:", error);
    }
  }

  // Filter out tools that start with specific prefixes
  const excludedPrefixes = ['legacy_', 'service_', 'applications_', 'authenticator', 'feature', 'http_', 'api_credential', 'api_execution_environments_', 'api_workflow', 'api_host', 'api_ad_hoc'];
  const filteredTools = allTools.filter(tool =>
    !excludedPrefixes.some(prefix => tool.name.startsWith(prefix))
  );
  const filteredCount = allTools.length - filteredTools.length;
  console.log(`Filtered out ${filteredCount} tools (prefixes: ${excludedPrefixes.join(', ')})`);

  return filteredTools;
};

let allTools: any[] = [];

const server = new Server(
  {
    name: "poc-aap-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  // Silently ignore filtered tools
  const excludedPrefixes = ['legacy_', 'service_', 'applications_', 'authenticator', 'feature', 'http_', 'api_credential', 'api_execution_environments_', 'api_workflow', 'api_host', 'api_ad_hoc', 'api_instance_'];
  if (excludedPrefixes.some(prefix => name.startsWith(prefix))) {
    return {
      content: [
        {
          type: "text",
          text: "Filtered tool calls are ignored",
        },
      ],
    };
  }

  // Find the matching tool
  const tool = allTools.find(t => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Execute the tool by making HTTP request
  try {
    // Build URL from path template and parameters
    let url = tool.pathTemplate;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${process.env.BEARER_TOKEN_OAUTH2_AUTHENTICATION}`,
      'Accept': 'application/json'
    };

    // Replace path parameters
    for (const param of tool.parameters || []) {
      if (param.in === 'path' && args[param.name]) {
        url = url.replace(`{${param.name}}`, String(args[param.name]));
      }
    }

    // Add query parameters
    const queryParams = new URLSearchParams();
    for (const param of tool.parameters || []) {
      if (param.in === 'query' && args[param.name] !== undefined) {
        queryParams.append(param.name, String(args[param.name]));
      }
    }
    if (queryParams.toString()) {
      url += '?' + queryParams.toString();
    }

    // Prepare request options
    const requestOptions: RequestInit = {
      method: tool.method.toUpperCase(),
      headers
    };

    // Add request body for POST, PUT, PATCH
    if (['POST', 'PUT', 'PATCH'].includes(tool.method.toUpperCase()) && args.requestBody) {
      headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(args.requestBody);
    }

    // Make HTTP request
    const response = await fetch(`http://localhost:44926${url}`, requestOptions);

    let result;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// Map to store transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

const MCP_PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;

const app = express();
app.use(express.json());

// Allow CORS for all domains, expose the Mcp-Session-Id header
app.use(cors({
  origin: '*',
  exposedHeaders: ["Mcp-Session-Id"]
}));

// MCP POST endpoint handler
const mcpPostHandler = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (sessionId) {
    console.log(`Received MCP request for session: ${sessionId}`);
  } else {
    console.log('Request body:', req.body);
  }

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId: string) => {
          console.log(`Session initialized with ID: ${sessionId}`);
          transports[sessionId] = transport;
        }
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
        }
      };

      // Connect the transport to the MCP server BEFORE handling the request
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    // Handle the request with existing transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
};

// MCP GET endpoint for SSE streams
const mcpGetHandler = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
  } else {
    console.log(`Establishing new SSE stream for session ${sessionId}`);
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// MCP DELETE endpoint for session termination
const mcpDeleteHandler = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  console.log(`Received session termination request for session ${sessionId}`);

  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
};

// Set up routes
app.post('/mcp', mcpPostHandler);
app.get('/mcp', mcpGetHandler);
app.delete('/mcp', mcpDeleteHandler);

async function main() {
  // Initialize tools before starting server
  allTools = await generateTools();
  console.log(`Loaded ${allTools.length} tools from OpenAPI specifications`);

  // Start HTTP server
  app.listen(MCP_PORT, (error?: Error) => {
    if (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
    console.log(`MCP Streamable HTTP Server listening on port ${MCP_PORT}`);
  });
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  // Close all active transports to properly clean up resources
  for (const sessionId in transports) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }

  console.log('Server shutdown complete');
  process.exit(0);
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
