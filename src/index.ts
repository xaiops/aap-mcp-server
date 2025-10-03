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
import type { McpToolDefinition } from "openapi-mcp-generator";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Load environment variables
config();

// Configuration constants
const CONFIG = {
  BASE_URL: "http://localhost:44926",
  MCP_PORT: process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000,
  FALLBACK_BEARER_TOKEN: process.env.BEARER_TOKEN_OAUTH2_AUTHENTICATION,
} as const;


type Persona = string[];

const anonymousPersona: Persona = [];

// Define personas - tool lists for different user types
const userPersona: Persona = [
  // EDA tools for regular users
  "eda.activations_list",
  "eda.activations_retrieve",
  "eda.projects_list",
  "eda.projects_retrieve",
  "eda.projects_partial_update",
  "eda.projects_sync_create",
  "eda.rulebooks_list",
  "eda.rulebooks_retrieve",
  "eda.decision_environments_list",
  "eda.decision_environments_retrieve",
  "eda.audit_rules_list",
  "eda.audit_rules_retrieve",
  "eda.event_streams_list",
  "eda.event_streams_retrieve",

  // Controller tools for job management
  "controller.jobs_list",
  "controller.jobs_read",
  "controller.jobs_stdout_read",
  "controller.job_templates_list",
  "controller.job_templates_read",
  "controller.job_templates_launch_read",
  "controller.inventories_list",
  "controller.inventories_read",
  "controller.projects_list",
  "controller.projects_read",
  "controller.organizations_list",
  "controller.organizations_read",

  // Galaxy tools for content
  "galaxy.collections_all_get",
  "galaxy.collection_versions_all_get"
];

const adminPersona: Persona = [
  // Include all user persona tools
  ...userPersona,

  // Additional admin-only tools
  "eda.users_list",
  "eda.users_retrieve",
  "eda.users_partial_update",
  "eda.teams_list",
  "eda.teams_retrieve",
  "eda.organizations_list",
  "eda.organizations_retrieve",
  "eda.eda_credentials_list",
  "eda.eda_credentials_retrieve",
  "eda.eda_credentials_create",
  "eda.eda_credentials_partial_update",
  "eda.eda_credentials_destroy",
  "eda.credential_types_list",
  "eda.credential_types_retrieve",
  "eda.credential_types_create",
  "eda.credential_types_partial_update",
  "eda.credential_types_destroy",
  "eda.decision_environments_create",
  "eda.decision_environments_partial_update",
  "eda.decision_environments_destroy",
  "eda.projects_destroy",
  "eda.activations_destroy",
  "eda.role_definitions_list",
  "eda.role_definitions_retrieve",
  "eda.role_definitions_create",
  "eda.role_definitions_update",
  "eda.role_user_assignments_list",
  "eda.role_user_assignments_create",
  "eda.role_team_assignments_list",
  "eda.role_team_assignments_create",

  // Gateway admin tools
  "gateway.users_list",
  "gateway.users_retrieve",
  // doesn't work well because of the 'password' field
  // we use controller.users_create instead for n
  // "gateway.users_create",
  "gateway.users_update",
  "gateway.users_partial_update",
  "gateway.users_destroy",
  "gateway.teams_list",
  "gateway.teams_retrieve",
  "gateway.teams_create",
  "gateway.teams_update",
  "gateway.teams_partial_update",
  "gateway.teams_destroy",
  "gateway.organizations_list",
  "gateway.organizations_retrieve",
  "gateway.organizations_create",
  "gateway.organizations_update",
  "gateway.organizations_partial_update",
  "gateway.organizations_destroy",
  "gateway.role_definitions_list",
  "gateway.role_definitions_retrieve",
  "gateway.role_definitions_create",
  "gateway.role_definitions_update",
  "gateway.role_definitions_partial_update",
  "gateway.role_definitions_destroy",

  // Controller admin tools
  "controller.users_create",
  "controller.credentials_list",
  "controller.credentials_read",
  "controller.credentials_delete",
  "controller.inventory_sources_list",
  "controller.inventory_sources_read",
  "controller.instances_list",
  "controller.instances_read",
  "controller.instance_groups_list",
  "controller.instance_groups_read"
];

// TypeScript interfaces
interface AAPMcpToolDefinition extends McpToolDefinition {
  deprecated: boolean;
  service?: string;
}

interface OpenApiSpecEntry {
  url: string;
  reformatFunc: (tool: AAPMcpToolDefinition) => AAPMcpToolDefinition | false;
  spec?: any;
  service?: string;
}

interface SessionData {
  [sessionId: string]: {
    token: string;
    is_superuser: boolean;
    is_platform_auditor: boolean;
  };
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
  if (sessionId && sessionData[sessionId]) {
    bearerToken = sessionData[sessionId].token;
    console.log(`Using session-specific Bearer token for session: ${sessionId}`);
  } else {
    console.log('Using fallback Bearer token from environment variable');
  }

  if (!bearerToken) {
    throw new Error('No Bearer token available. Please provide an Authorization header or set BEARER_TOKEN_OAUTH2_AUTHENTICATION environment variable.');
  }

  return bearerToken;
};

// Validate authorization token and extract user permissions
const validateTokenAndGetPermissions = async (bearerToken: string): Promise<{is_superuser: boolean, is_platform_auditor: boolean}> => {
  try {
    const response = await fetch(`${CONFIG.BASE_URL}/api/gateway/v1/me/`, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;

    if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
      throw new Error('Invalid response format from /api/gateway/v1/me/');
    }

    const userInfo = data.results[0] as any;
    return {
      is_superuser: userInfo.is_superuser || false,
      is_platform_auditor: userInfo.is_platform_auditor || false
    };
  } catch (error) {
    console.error('Token validation failed:', error);
    throw new Error(`Token validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const storeSessionData = (sessionId: string, token: string, permissions: {is_superuser: boolean, is_platform_auditor: boolean}): void => {
  sessionData[sessionId] = {
    token,
    is_superuser: permissions.is_superuser,
    is_platform_auditor: permissions.is_platform_auditor
  };
  console.log(`Stored session data for ${sessionId}: superuser=${permissions.is_superuser}, auditor=${permissions.is_platform_auditor}`);
};

// Determine user persona based on permissions
const getUserPersona = (sessionId: string | undefined, personaOverride?: string): Persona => {
  // If a persona override is specified, use it regardless of permissions
  if (personaOverride) {
    switch (personaOverride.toLowerCase()) {
      case 'anonymous':
        return anonymousPersona;
      case 'user':
        return userPersona;
      case 'admin':
        return adminPersona;
      default:
        console.warn(`Unknown persona override: ${personaOverride}, defaulting to anonymous`);
        return anonymousPersona;
    }
  }

  if (!sessionId || !sessionData[sessionId]) {
    return anonymousPersona; // Default to anonymous persona for unauthenticated users
  }

  const session = sessionData[sessionId];
  // Administrators get the full admin persona, regular users get the limited user persona
  return session.is_superuser ? adminPersona : userPersona;
};

// Filter tools based on persona
const filterToolsByPersona = (tools: ToolWithSize[], persona: Persona): ToolWithSize[] => {
  return tools.filter(tool => persona.includes(tool.name));
};

// Load OpenAPI specifications from HTTP URLs
const loadOpenApiSpecs = async (): Promise<OpenApiSpecEntry[]> => {
  const specUrls: OpenApiSpecEntry[] = [
    {
      url: `${CONFIG.BASE_URL}/api/eda/v1/openapi.json`,
      reformatFunc: (tool: AAPMcpToolDefinition) => {
        tool.name = "eda." + tool.name;
        tool.pathTemplate = "/api/eda/v1" + tool.pathTemplate;
        return tool;
      },
      service: 'eda',
    },
    {
      url: `${CONFIG.BASE_URL}/api/gateway/v1/docs/schema/`,
      reformatFunc: (tool: AAPMcpToolDefinition) => {
        tool.name = "gateway." + tool.name;
        tool.description = tool.description?.trim().split('\n\n')[0];
        if (tool.description?.includes("Legacy")) {
          return false
        }
        return tool;
      },
      service: 'gateway',
    },
    {
      url: `${CONFIG.BASE_URL}/api/galaxy/v3/openapi.json`,
      reformatFunc: (tool: AAPMcpToolDefinition) => {
        if (tool.pathTemplate?.startsWith("/api/galaxy/_ui")) {
          return false
        }
        if (!tool.name.startsWith("api_galaxy_v3")) {
          // Hide the other namespaces
          return false
        }
        tool.name = tool.name.replace(/(api_galaxy_v3_|api_galaxy_|)(.+)/, "galaxy.$2");
        return tool;
      },
      service: 'galaxy',
    },
    {
      url: "https://s3.amazonaws.com/awx-public-ci-files/release_4.6/schema.json",
      reformatFunc: (tool: AAPMcpToolDefinition) => {
        tool.pathTemplate = tool.pathTemplate?.replace("/api/v2", "/api/controller/v2");
        tool.name = tool.name.replace(/api_(.+)/, "controller.$1");
        tool.description = tool.description?.trim().split('\n\n')[0];
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
  let rawToolList: AAPMcpToolDefinition[] = [];

  for (const spec of openApiSpecs) {
    try {
      const tools = await getToolsFromOpenApi(spec.spec, {
        baseUrl: CONFIG.BASE_URL,
        dereference: true,
      }) as AAPMcpToolDefinition[];
      const filteredTools = tools.filter((tool) => {
        tool.service = spec.service; // Add service information to each tool
        const result = spec.reformatFunc(tool);
        return result !== false;
      }).filter(tool => !tool.deprecated); // Controller API doesn't expose the deprecated flag yet
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

  // Generate CSV content
  const csvHeader = 'Tool name,size (characters),description,path template,service\n';
  const csvRows = toolsWithSize.map(tool =>
    `${tool.name},${tool.size},"${tool.description}",${tool.pathTemplate},${tool.service || 'unknown'}`
  ).join('\n');
  const csvContent = csvHeader + csvRows;

  // Write the tools list in the local environment
  if (process.env.NODE_ENV === "development") {
    writeFileSync('tool_list.csv', csvContent, 'utf8');
    console.log(`Tool list saved to tool_list.csv (${toolsWithSize.length} tools)`);
  }

  return toolsWithSize;
};

let allTools: ToolWithSize[] = [];

const server = new Server(
  {
    name: "aap",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
  // Get the session ID from the transport context
  const sessionId = extra?.sessionId;

  // Get persona override from transport if available
  const transport = sessionId ? transports[sessionId] : null;
  const personaOverride = transport ? (transport as any).personaOverride : undefined;

  // Determine user persona based on session permissions or override
  const persona = getUserPersona(sessionId, personaOverride);

  // Filter tools based on persona
  const filteredTools = filterToolsByPersona(allTools, persona);

  let personaType = 'anonymous';
  if (persona === userPersona) personaType = 'user';
  else if (persona === adminPersona) personaType = 'admin';

  const overrideInfo = personaOverride ? ` (override: ${personaOverride})` : '';
  console.log(`Returning ${filteredTools.length} tools for ${personaType} persona${overrideInfo} (session: ${sessionId || 'none'})`);

  return {
    tools: filteredTools.map(tool => ({
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
const sessionData: SessionData = {};

const app = express();
app.use(express.json());

// Allow CORS for all domains, expose the Mcp-Session-Id header
app.use(cors({
  origin: '*',
  exposedHeaders: ["Mcp-Session-Id"]
}));


// MCP POST endpoint handler
const mcpPostHandler = async (req: express.Request, res: express.Response, personaOverride?: string) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const authHeader = req.headers['authorization'] as string;

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
        onsessioninitialized: async (sessionId: string) => {
          console.log(`Session initialized with ID: ${sessionId}${personaOverride ? ` with persona override: ${personaOverride}` : ''}`);
          transports[sessionId] = transport;

          // Store persona override in transport for later access
          (transport as any).personaOverride = personaOverride;

          // Extract and validate the bearer token
          const token = extractBearerToken(authHeader);
          if (token) {
            try {
              // Validate token and get user permissions
              const permissions = await validateTokenAndGetPermissions(token);

              // Store both token and permissions in session data
              storeSessionData(sessionId, token, permissions);
            } catch (error) {
              console.error(`Failed to validate token for session ${sessionId}:`, error);
              // Token validation failed, we cannot create the session without valid token
              throw error;
            }
          } else {
            console.warn(`No bearer token provided for session ${sessionId}`);
          }
        }
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}, removing from transports map`);
          delete transports[sid];
          // Clean up session data
          if (sessionData[sid]) {
            delete sessionData[sid];
            console.log(`Removed session data for session: ${sid}`);
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
const mcpGetHandler = async (req: express.Request, res: express.Response, personaOverride?: string) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const authHeader = req.headers['authorization'] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  // Note: Token updates are not supported in GET requests - tokens are validated only during session initialization

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
const mcpDeleteHandler = async (req: express.Request, res: express.Response, personaOverride?: string) => {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  console.log(`Received session termination request for session ${sessionId}`);

  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);

    // Clean up session data when session is terminated
    if (sessionData[sessionId]) {
      delete sessionData[sessionId];
      console.log(`Removed session data for terminated session: ${sessionId}`);
    }
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
};

// Set up routes
app.post('/mcp', (req, res) => mcpPostHandler(req, res));
app.get('/mcp', (req, res) => mcpGetHandler(req, res));
app.delete('/mcp', (req, res) => mcpDeleteHandler(req, res));

// Persona-specific routes
app.post('/:persona/mcp', (req, res) => {
  const persona = req.params.persona;
  console.log(`Persona-specific POST request for persona: ${persona}`);
  return mcpPostHandler(req, res, persona);
});

app.get('/:persona/mcp', (req, res) => {
  const persona = req.params.persona;
  console.log(`Persona-specific GET request for persona: ${persona}`);
  return mcpGetHandler(req, res, persona);
});

app.delete('/:persona/mcp', (req, res) => {
  const persona = req.params.persona;
  console.log(`Persona-specific DELETE request for persona: ${persona}`);
  return mcpDeleteHandler(req, res, persona);
});

async function main(): Promise<void> {
  try {
    // Initialize tools before starting server
    console.log('Loading OpenAPI specifications and generating tools...');
    allTools = await generateTools();
    console.log(`Successfully loaded ${allTools.length} tools`);

    // Calculate and display persona sizes
    const anonymousTools = filterToolsByPersona(allTools, anonymousPersona);
    const userTools = filterToolsByPersona(allTools, userPersona);
    const adminTools = filterToolsByPersona(allTools, adminPersona);

    const anonymousSize = anonymousTools.reduce((sum, tool) => sum + (tool.size || 0), 0);
    const userSize = userTools.reduce((sum, tool) => sum + (tool.size || 0), 0);
    const adminSize = adminTools.reduce((sum, tool) => sum + (tool.size || 0), 0);

    console.log('\n=== Persona Size Summary ===');
    console.log(`Anonymous: ${anonymousTools.length} tools, ${anonymousSize.toLocaleString()} characters`);
    console.log(`User: ${userTools.length} tools, ${userSize.toLocaleString()} characters`);
    console.log(`Admin: ${adminTools.length} tools, ${adminSize.toLocaleString()} characters`);
    console.log('============================\n');

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
      // Clean up session data
      if (sessionData[sessionId]) {
        delete sessionData[sessionId];
      }
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
