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
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { readFileSync } from "fs";
import { join } from "path";

// Load environment variables
config();

// Configuration constants
const CONFIG = {
  BASE_URL: "http://localhost:44926",
  MCP_PORT: process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000,
  FALLBACK_BEARER_TOKEN: process.env.BEARER_TOKEN_OAUTH2_AUTHENTICATION,
} as const;

// TypeScript interfaces
interface OpenApiSpecEntry {
  url: string;
  reformatFunc: (tool: any) => any;
  spec?: any;
}

interface SessionTokens {
  [sessionId: string]: string;
}

interface ToolWithSize {
  name: string;
  description: string;
  inputSchema: any;
  pathTemplate: string;
  method: string;
  parameters?: any[];
  size: number;
  deprecated?: boolean;
  service?: string;
}

// Helper functions
const extractBearerToken = (authHeader: string | undefined): string | undefined => {
  return authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : undefined;
};

const getBearerTokenForSession = (sessionId: string | undefined): string => {
  let bearerToken = CONFIG.FALLBACK_BEARER_TOKEN;
  if (sessionId && sessionTokens[sessionId]) {
    bearerToken = sessionTokens[sessionId];
    console.log(`Using session-specific Bearer token for session: ${sessionId}`);
  } else {
    console.log('Using fallback Bearer token from environment variable');
  }

  if (!bearerToken) {
    throw new Error('No Bearer token available. Please provide an Authorization header or set BEARER_TOKEN_OAUTH2_AUTHENTICATION environment variable.');
  }

  return bearerToken;
};

const storeBearerTokenForSession = (sessionId: string, authHeader: string | undefined): void => {
  const token = extractBearerToken(authHeader);
  if (token) {
    sessionTokens[sessionId] = token;
    console.log(`Updated Bearer token for session: ${sessionId}`);
  }
};

// Load OpenAPI specifications from HTTP URLs
const loadOpenApiSpecs = async (): Promise<OpenApiSpecEntry[]> => {
  const specUrls: OpenApiSpecEntry[] = [
    {
      url: `${CONFIG.BASE_URL}/api/eda/v1/openapi.json`,
      reformatFunc: (tool: Tool) => {
        tool.name = "eda." + tool.name;
        tool.pathTemplate = "/api/eda/v1" + tool.pathTemplate;
        return tool;
      },
      service: 'eda',
    },
    {
      url: `${CONFIG.BASE_URL}/api/gateway/v1/docs/schema/`,
      reformatFunc: (tool: Tool) => {
        tool.name = "gateway." + tool.name;
        if (tool.description.includes("Legacy")) {
          return false
        }
        return tool;
      },
      service: 'gateway',
    },
    {
      url: `${CONFIG.BASE_URL}/api/galaxy/v3/openapi.json`,
      reformatFunc: (tool: Tool) => {
        if (tool.pathTemplate.startsWith("/api/galaxy/_ui")) {
          return false
        }
        tool.name = tool.name.replace(/(api_galaxy_v3_|api_galaxy_|)(.+)/, "galaxy.$2");
        return tool;
      },
      service: 'galaxy',
    },
    {
      url: "https://s3.amazonaws.com/awx-public-ci-files/release_4.6/schema.json",
      reformatFunc: (tool: Tool) => {
        tool.pathTemplate = tool.pathTemplate.replace("/api/v2", "/api/controller/v2");
        tool.name = tool.name.replace(/api_(.+)/, "controller.$1");
        tool.description = tool.description.trim().split('\n\n')[0];
        return tool;
      },
      service: 'controller',
    },
  ];

  for (const specEntry of specUrls) {
    try {
      console.log(`Fetching OpenAPI spec from: ${specEntry.url}`);
      const response = await fetch(specEntry.url, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`Failed to fetch ${specEntry.url}: ${response.status} ${response.statusText}`);
        continue;
      }

      specEntry.spec = await response.json();
      console.log(`Successfully loaded OpenAPI spec from: ${specEntry.url}`);
    } catch (error) {
      console.error(`Error fetching OpenAPI spec from ${specEntry.url}:`, error);
      // Continue with other URLs even if one fails
    }
  }

  console.log(`Number of OpenAPIv3 files loaded=${specUrls.length}`)
  return specUrls;
};

// Generate tools from OpenAPI specs
const generateTools = async (): Promise<ToolWithSize[]> => {
  const openApiSpecs = await loadOpenApiSpecs();
  let rawToolList: any[] = [];

  for (const spec of openApiSpecs) {
    try {
      const tools = await getToolsFromOpenApi(spec.spec, {
        baseUrl: CONFIG.BASE_URL,
        dereference: true,
      });
      const filteredTools = tools.filter((tool) => {
        tool.service = spec.service; // Add service information to each tool
        return spec.reformatFunc(tool);
      });
      rawToolList = rawToolList.concat(filteredTools);
    } catch (error) {
      console.error("Error generating tools from OpenAPI spec:", error);
    }
  }

  // Calculate size for each tool and sort by size
  const toolsWithSize: ToolWithSize[] = rawToolList.map(tool => {
    const toolSize = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }).length;
    return {
      ...tool,
      size: toolSize
    };
  });

  // Sort by size in descending order
  toolsWithSize.sort((a, b) => b.size - a.size);

  console.log("=== TOOLS BY SIZE ===");
  console.log(`Tool name,size (characters),description,path template,service`);
  toolsWithSize.forEach((tool, index) => {
    console.log(`${tool.name},${tool.size},"${tool.description}",${tool.pathTemplate},${tool.service || 'unknown'}`);
  });
  console.log("=== END OF TOOLS BY SIZE ===");

  const filteredTools = toolsWithSize.
        filter(tool => !tool.deprecated).
        //filter(tool => allowList.some(allowed => tool.name == allowed)
        filter(tool => tool.size < 500);

  const fullSize = toolsWithSize.reduce((accumulator, currentValue) => accumulator + currentValue.size, 0);
  const loadedSize = filteredTools.reduce((accumulator, currentValue) => accumulator + currentValue.size, 0);

  console.log(`Tool number=${filteredTools.length} loadedSize=${loadedSize}, fullSize=${fullSize} characters`);
  console.log(`Cherry-picked ${filteredTools.length} tools from OpenAPI specifications (${toolsWithSize.length} were available)`);
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

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;

  // Find the matching tool
  const tool = allTools.find(t => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Get the session ID from the transport context
  const sessionId = extra?.sessionId;

  // Get the Bearer token for this session
  const bearerToken = getBearerTokenForSession(sessionId);

  // Execute the tool by making HTTP request
  try {
    // Build URL from path template and parameters
    let url = tool.pathTemplate;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${bearerToken}`,
      'Accept': 'application/json'
    };

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
    const fullUrl = `${CONFIG.BASE_URL}${url}`;
    console.log(`Calling: ${fullUrl}`);
    const response = await fetch(fullUrl, requestOptions);

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

// Global state management
const transports: Record<string, StreamableHTTPServerTransport> = {};
const sessionTokens: SessionTokens = {};

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
  const authHeader = req.headers['authorization'] as string;

  if (sessionId) {
    console.log(`Received MCP request for session: ${sessionId}`);
    storeBearerTokenForSession(sessionId, authHeader);
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
          storeBearerTokenForSession(sessionId, authHeader);
        }
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
          // Also clean up the session token
          if (sessionTokens[sid]) {
            delete sessionTokens[sid];
            console.log(`Removed Bearer token for session: ${sid}`);
          }
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
  const authHeader = req.headers['authorization'] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  // Update Bearer token for this session if provided
  storeBearerTokenForSession(sessionId, authHeader);

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

    // Clean up the session token when session is terminated
    if (sessionTokens[sessionId]) {
      delete sessionTokens[sessionId];
      console.log(`Removed Bearer token for terminated session: ${sessionId}`);
    }
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

async function main(): Promise<void> {
  try {
    // Initialize tools before starting server
    console.log('Loading OpenAPI specifications and generating tools...');
    allTools = await generateTools();
    console.log(`Successfully loaded ${allTools.length} tools`);

    // Start HTTP server
    app.listen(CONFIG.MCP_PORT, (error?: Error) => {
      if (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
      }
      console.log(`MCP Streamable HTTP Server listening on port ${CONFIG.MCP_PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
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
