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
import * as yaml from "js-yaml";
import { ToolLogger, type LogEntry } from "./logger.js";

// Load environment variables
config();

// Configuration constants
const CONFIG = {
  BASE_URL: process.env.BASE_URL || "http://localhost:44926",
  MCP_PORT: process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000,
  FALLBACK_BEARER_TOKEN: process.env.BEARER_TOKEN_OAUTH2_AUTHENTICATION,
} as const;


type Persona = string[];

interface PersonaConfig {
  record_api_queries?: boolean;
  'ignore-certificate-errors'?: boolean;
  personas: Record<string, string[]>;
}

// Load personas from configuration file
const loadPersonasFromConfig = (): PersonaConfig => {
  const configPath = join(process.cwd(), 'aap-mcp.yaml');
  const configFile = readFileSync(configPath, 'utf8');
  const config = yaml.load(configFile) as PersonaConfig;

  if (!config.personas) {
    throw new Error('Invalid configuration: missing personas section');
  }

  return config;
};

// Load personas from configuration
const personaConfig = loadPersonasFromConfig();
const allPersonas: Record<string, Persona> = personaConfig.personas;

// Log configuration settings
console.log(`BASE_URL: ${CONFIG.BASE_URL}`);

// Get API query recording setting (defaults to false)
const recordApiQueries = personaConfig.record_api_queries ?? false;
console.log(`API query recording: ${recordApiQueries ? 'ENABLED' : 'DISABLED'}`);

// Get certificate validation setting (defaults to false)
const ignoreCertificateErrors = personaConfig['ignore-certificate-errors'] ?? false;
console.log(`Certificate validation: ${ignoreCertificateErrors ? 'DISABLED' : 'ENABLED'}`);

// Configure HTTPS certificate validation globally
if (ignoreCertificateErrors) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('WARNING: HTTPS certificate validation is disabled. This should only be used in development/testing environments.');
}

// TypeScript interfaces
interface AAPMcpToolDefinition extends McpToolDefinition {
  deprecated: boolean;
  service?: string;
}

interface OpenApiSpecEntry {
  url: string;
  localPath?: string;
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
    const personaName = personaOverride.toLowerCase();
    if (allPersonas[personaName]) {
      return allPersonas[personaName];
    } else {
      console.warn(`Unknown persona override: ${personaOverride}, defaulting to anonymous`);
      return allPersonas['anonymous'] || [];
    }
  }

  if (!sessionId || !sessionData[sessionId]) {
    return allPersonas['anonymous'] || []; // Default to anonymous persona for unauthenticated users
  }

  const session = sessionData[sessionId];
  // Administrators get the admin persona, regular users get the user persona
  if (session.is_superuser && allPersonas['admin']) {
    return allPersonas['admin'];
  } else if (allPersonas['user']) {
    return allPersonas['user'];
  } else {
    // Fallback to anonymous if user/admin personas don't exist
    return allPersonas['anonymous'] || [];
  }
};

// Filter tools based on persona
const filterToolsByPersona = (tools: ToolWithSize[], persona: Persona): ToolWithSize[] => {
  return tools.filter(tool => persona.includes(tool.name));
};

// Load OpenAPI specifications from HTTP URLs with local fallback
const loadOpenApiSpecs = async (): Promise<OpenApiSpecEntry[]> => {
  const specUrls: OpenApiSpecEntry[] = [
    {
      url: `${CONFIG.BASE_URL}/api/eda/v1/openapi.json`,
      localPath: join(process.cwd(), 'data/eda-openapi.json'),
      reformatFunc: (tool: AAPMcpToolDefinition) => {
        tool.name = "eda." + tool.name;
        tool.pathTemplate = "/api/eda/v1" + tool.pathTemplate;
        return tool;
      },
      service: 'eda',
    },
    {
      url: `${CONFIG.BASE_URL}/api/gateway/v1/docs/schema/`,
      localPath: join(process.cwd(), 'data/gateway-schema.json'),
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
      localPath: join(process.cwd(), 'data/galaxy-openapi.json'),
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
      localPath: join(process.cwd(), 'data/controller-schema.json'),
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      specEntry.spec = await response.json();
      console.log(`Successfully loaded OpenAPI spec from: ${specEntry.url}`);
    } catch (error) {
      console.error(`Error fetching OpenAPI spec from ${specEntry.url}:`, error);

      // Try to load from local file as fallback
      try {
        console.log(`Attempting to load from local file: ${specEntry.localPath}`);
        const localContent = readFileSync(specEntry.localPath!, 'utf8');
        specEntry.spec = JSON.parse(localContent);
        console.log(`Successfully loaded OpenAPI spec from local file: ${specEntry.localPath}`);
      } catch (localError) {
        console.error(`Error loading local OpenAPI spec from ${specEntry.localPath}:`, localError);
        // Continue with other URLs even if both remote and local fail
      }
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
    console.log(`Loading ${spec.service}`);
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

// Initialize logger
const toolLogger = new ToolLogger();

// Helper function to read log entries for a tool
const getToolLogEntries = async (toolName: string): Promise<LogEntry[]> => {
  const logFile = join(process.cwd(), 'logs', `${toolName}.jsonl`);
  try {
    const content = readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(line => line);
    return lines.map(line => JSON.parse(line) as LogEntry);
  } catch (error) {
    // Log file doesn't exist or can't be read
    return [];
  }
};

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

  // Determine persona type by comparing with known personas
  let personaType = 'unknown';
  for (const [name, tools] of Object.entries(allPersonas)) {
    if (persona === tools) {
      personaType = name;
      break;
    }
  }

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
  let result: any;
  let response: Response | undefined;
  let fullUrl: string = `${CONFIG.BASE_URL}${tool.pathTemplate}`;
  let requestOptions: RequestInit | undefined;

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
    requestOptions = {
      method: tool.method.toUpperCase(),
      headers
    };

    // Add request body for POST, PUT, PATCH
    if (['POST', 'PUT', 'PATCH'].includes(tool.method.toUpperCase()) && args.requestBody) {
      headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(args.requestBody);
    }

    // Make HTTP request
    fullUrl = `${CONFIG.BASE_URL}${url}`;
    console.log(`Calling: ${fullUrl}`);
    response = await fetch(fullUrl, requestOptions);

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    // Log the tool access (only if recording is enabled)
    if (recordApiQueries) {
      await toolLogger.logToolAccess(
        tool,
        fullUrl,
        {
          method: tool.method.toUpperCase(),
          headers: headers,
          body: requestOptions.body ? JSON.parse(requestOptions.body as string) : undefined,
          args: args
        },
        result,
        response.status
      );
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
    // Log the failed tool access (only if recording is enabled)
    if (recordApiQueries) {
      await toolLogger.logToolAccess(
        tool,
        fullUrl,
        {
          method: tool.method.toUpperCase(),
          headers: {},
          body: requestOptions?.body ? JSON.parse(requestOptions.body as string) : undefined,
          args: args
        },
        { error: error instanceof Error ? error.message : String(error) },
        response?.status || 0
      );
    }

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

// Tool list HTML endpoint
app.get('/tools', (req, res) => {
  try {
    const toolRows = allTools.map(tool => `
      <tr>
        <td><a href="/tools/${encodeURIComponent(tool.name)}" style="color: #007acc; text-decoration: none;">${tool.name}</a></td>
        <td>${tool.size}</td>
        <td>${tool.description || ''}</td>
        <td><code>${tool.pathTemplate}</code></td>
        <td><span class="service-${tool.service || 'unknown'}">${tool.service || 'unknown'}</span></td>
      </tr>
    `).join('');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AAP MCP Tools List</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
        }
        .stats {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #007acc;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f2f2f2;
        }
        tr:hover {
            background-color: #e6f3ff;
        }
        code {
            background-color: #f4f4f4;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: monospace;
        }
        .service-eda { background-color: #e3f2fd; padding: 3px 6px; border-radius: 3px; }
        .service-controller { background-color: #f3e5f5; padding: 3px 6px; border-radius: 3px; }
        .service-gateway { background-color: #e8f5e8; padding: 3px 6px; border-radius: 3px; }
        .service-galaxy { background-color: #fff3e0; padding: 3px 6px; border-radius: 3px; }
        .service-unknown { background-color: #ffebee; padding: 3px 6px; border-radius: 3px; }
        .service-operator { background-color: #e1f5fe; padding: 3px 6px; border-radius: 3px; }
        .actions {
            margin-bottom: 20px;
        }
        .btn {
            background-color: #007acc;
            color: white;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
        }
        .btn:hover {
            background-color: #005a9e;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>AAP MCP Tools List</h1>

        <div class="stats">
            <strong>Total Tools:</strong> ${allTools.length}<br>
            <strong>Total Size:</strong> ${allTools.reduce((sum, tool) => sum + (tool.size || 0), 0).toLocaleString()} characters
        </div>

        <div class="actions">
            <a href="/export/tools/csv" class="btn">Download CSV</a>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Tool Name</th>
                    <th>Size (chars)</th>
                    <th>Description</th>
                    <th>Path Template</th>
                    <th>Service</th>
                </tr>
            </thead>
            <tbody>
                ${toolRows}
            </tbody>
        </table>
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating HTML tool list:', error);
    res.status(500).json({
      error: 'Failed to generate tool list HTML',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Individual tool details endpoint
app.get('/tools/:name', async (req, res) => {
  try {
    const toolName = req.params.name;

    // Find the tool
    const tool = allTools.find(t => t.name === toolName);
    if (!tool) {
      return res.status(404).json({
        error: 'Tool not found',
        message: `Tool '${toolName}' does not exist`
      });
    }

    // Get log entries for this tool
    const logEntries = await getToolLogEntries(toolName);
    const last10Calls = logEntries.slice(-10).reverse(); // Get last 10, most recent first

    // Calculate error code summary
    const errorCodeSummary = logEntries.reduce((acc, entry) => {
      const code = entry.return_code;
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    // Check which personas have access to this tool
    const personasWithAccess = [];
    const personaColors: Record<string, string> = {
      'anonymous': '#6c757d',
      'user': '#28a745',
      'admin': '#dc3545',
      'operator': '#17a2b8'
    };

    for (const [personaName, personaTools] of Object.entries(allPersonas)) {
      if (personaTools.includes(toolName)) {
        personasWithAccess.push({
          name: personaName,
          displayName: personaName.charAt(0).toUpperCase() + personaName.slice(1),
          color: personaColors[personaName] || '#6c757d'
        });
      }
    }

    // Helper function to format timestamp for display
    const formatTimestamp = (timestamp: string) => {
      return new Date(timestamp).toLocaleString();
    };

    // Helper function to get status color
    const getStatusColor = (code: number) => {
      if (code >= 200 && code < 300) return '#28a745'; // green
      if (code >= 300 && code < 400) return '#ffc107'; // yellow
      if (code >= 400 && code < 500) return '#fd7e14'; // orange
      if (code >= 500) return '#dc3545'; // red
      return '#6c757d'; // gray
    };

    // Helper function to get status text
    const getStatusText = (code: number) => {
      if (code >= 200 && code < 300) return 'Success';
      if (code >= 300 && code < 400) return 'Redirect';
      if (code >= 400 && code < 500) return 'Client Error';
      if (code >= 500) return 'Server Error';
      return 'Unknown';
    };

    // Format the input schema for display
    const formatSchema = (schema: any, level = 0) => {
      if (!schema) return 'No schema defined';

      const indent = '  '.repeat(level);
      let result = '';

      if (schema.type === 'object' && schema.properties) {
        result += '{\n';
        for (const [key, value] of Object.entries(schema.properties)) {
          const prop = value as any;
          const required = schema.required?.includes(key) ? ' (required)' : '';
          result += `${indent}  "${key}"${required}: `;
          if (prop.type === 'object') {
            result += formatSchema(prop, level + 1);
          } else {
            result += `${prop.type || 'any'}`;
            if (prop.description) result += ` // ${prop.description}`;
          }
          result += '\n';
        }
        result += `${indent}}`;
      } else {
        result = JSON.stringify(schema, null, 2);
      }

      return result;
    };

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${tool.name} - Tool Details</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
            line-height: 1.6;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        .tool-header {
            display: flex;
            align-items: center;
            margin-bottom: 30px;
        }
        .service-badge {
            background-color: #007acc;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-left: 15px;
        }
        .service-eda { background-color: #2196f3; }
        .service-controller { background-color: #9c27b0; }
        .service-gateway { background-color: #4caf50; }
        .service-galaxy { background-color: #ff9800; }
        .service-unknown { background-color: #f44336; }
        .navigation {
            margin-bottom: 30px;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
        }
        .nav-link:hover {
            background-color: #5a6268;
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .info-card {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #007acc;
        }
        .info-card h3 {
            margin-top: 0;
            color: #333;
            font-size: 1.1em;
        }
        .info-value {
            font-family: monospace;
            background-color: #e9ecef;
            padding: 8px;
            border-radius: 4px;
            word-break: break-all;
        }
        .description-section {
            background-color: #e3f2fd;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .description-section h2 {
            margin-top: 0;
            color: #1976d2;
        }
        .schema-section {
            background-color: #f5f5f5;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .schema-section h2 {
            margin-top: 0;
            color: #333;
        }
        .schema-code {
            background-color: #2d3748;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            white-space: pre;
            font-size: 0.9em;
        }
        .personas-section {
            background-color: #f0f9ff;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .personas-section h2 {
            margin-top: 0;
            color: #0369a1;
        }
        .persona-badges {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .persona-badge {
            padding: 8px 16px;
            border-radius: 20px;
            color: white;
            text-decoration: none;
            font-weight: bold;
            transition: opacity 0.3s ease;
        }
        .persona-badge:hover {
            opacity: 0.8;
            text-decoration: none;
            color: white;
        }
        .no-personas {
            color: #6c757d;
            font-style: italic;
        }
        .method-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .method-get { background-color: #28a745; color: white; }
        .method-post { background-color: #007bff; color: white; }
        .method-put { background-color: #ffc107; color: black; }
        .method-patch { background-color: #6f42c1; color: white; }
        .method-delete { background-color: #dc3545; color: white; }
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 20px;
            margin-top: 15px;
        }
        .stat-card {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e9ecef;
        }
        .stat-card h4 {
            margin-top: 0;
            color: #495057;
        }
        .code-summary {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .code-entry {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: white;
            border-radius: 4px;
            gap: 10px;
        }
        .code-number {
            font-weight: bold;
            font-family: monospace;
            min-width: 40px;
        }
        .code-text {
            flex: 1;
            color: #6c757d;
        }
        .code-count {
            font-size: 0.9em;
            color: #495057;
        }
        .calls-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .call-entry {
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 15px;
            background-color: white;
        }
        .call-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .call-timestamp {
            font-size: 0.9em;
            color: #6c757d;
        }
        .call-status {
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
        }
        .call-endpoint {
            font-family: monospace;
            background-color: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            word-break: break-all;
            font-size: 0.9em;
        }
        .call-error {
            margin-top: 8px;
            padding: 8px;
            background-color: #f8d7da;
            color: #721c24;
            border-radius: 4px;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="navigation">
            <a href="/tools" class="nav-link">← All Tools</a>
            <a href="/persona" class="nav-link">Personas</a>
            <a href="/export/tools/csv" class="nav-link">Download CSV</a>
        </div>

        <div class="tool-header">
            <h1>${tool.name}</h1>
            <span class="service-badge service-${tool.service || 'unknown'}">${tool.service || 'unknown'}</span>
        </div>

        <div class="schema-section">
            <h2>Usage Statistics</h2>
            ${logEntries.length > 0 ? `
            <p><strong>Total Calls:</strong> ${logEntries.length}</p>
            <div class="stats-grid">
                <div class="stat-card">
                    <h4>Response Codes</h4>
                    <div class="code-summary">
                        ${Object.entries(errorCodeSummary).map(([code, count]) => `
                        <div class="code-entry" style="border-left: 4px solid ${getStatusColor(Number(code))};">
                            <span class="code-number">${code}</span>
                            <span class="code-text">${getStatusText(Number(code))}</span>
                            <span class="code-count">${count} calls</span>
                        </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            ` : '<p><em>No usage data available</em></p>'}
        </div>

        ${last10Calls.length > 0 ? `
        <div class="schema-section">
            <h2>Recent Calls (Last 10)</h2>
            <div class="calls-list">
                ${last10Calls.map(entry => `
                <div class="call-entry">
                    <div class="call-header">
                        <span class="call-timestamp">${formatTimestamp(entry.timestamp)}</span>
                        <span class="call-status" style="background-color: ${getStatusColor(entry.return_code)};">
                            ${entry.return_code} ${getStatusText(entry.return_code)}
                        </span>
                    </div>
                    <div class="call-endpoint">${entry.endpoint}</div>
                    ${entry.response && typeof entry.response === 'object' && entry.response.error ? `
                    <div class="call-error">Error: ${entry.response.error}</div>
                    ` : ''}
                </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        ${tool.description ? `
        <div class="description-section">
            <h2>Description</h2>
            <p>${tool.description}</p>
        </div>
        ` : ''}

        <div class="info-grid">
            <div class="info-card">
                <h3>HTTP Method</h3>
                <div>
                    <span class="method-badge method-${tool.method.toLowerCase()}">${tool.method.toUpperCase()}</span>
                </div>
            </div>

            <div class="info-card">
                <h3>Path Template</h3>
                <div class="info-value">${tool.pathTemplate}</div>
            </div>

            <div class="info-card">
                <h3>Tool Size</h3>
                <div class="info-value">${tool.size.toLocaleString()} characters</div>
            </div>

            <div class="info-card">
                <h3>Service</h3>
                <div class="info-value">${tool.service || 'unknown'}</div>
            </div>
        </div>

        <div class="personas-section">
            <h2>Available to Personas</h2>
            ${personasWithAccess.length > 0 ? `
            <div class="persona-badges">
                ${personasWithAccess.map(persona => `
                <a href="/persona/${persona.name}" class="persona-badge" style="background-color: ${persona.color};">
                    ${persona.displayName}
                </a>
                `).join('')}
            </div>
            ` : '<p class="no-personas">This tool is not available to any persona.</p>'}
        </div>

        ${tool.inputSchema ? `
        <div class="schema-section">
            <h2>Input Schema</h2>
            <div class="schema-code">${formatSchema(tool.inputSchema)}</div>
        </div>
        ` : ''}

        ${tool.parameters && tool.parameters.length > 0 ? `
        <div class="schema-section">
            <h2>Parameters</h2>
            <div class="schema-code">${JSON.stringify(tool.parameters, null, 2)}</div>
        </div>
        ` : ''}
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating tool details:', error);
    res.status(500).json({
      error: 'Failed to generate tool details',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Tool list CSV endpoint
app.get('/export/tools/csv', (req, res) => {
  try {
    // Generate CSV content
    const csvHeader = 'Tool name,size (characters),description,path template,service\n';
    const csvRows = allTools.map(tool =>
      `${tool.name},${tool.size},"${tool.description?.replace(/"/g, '""') || ''}",${tool.pathTemplate},${tool.service || 'unknown'}`
    ).join('\n');
    const csvContent = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tool_list.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Error generating CSV tool list:', error);
    res.status(500).json({
      error: 'Failed to generate tool list CSV',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Persona overview endpoint
app.get('/persona', (req, res) => {
  try {
    // Define persona descriptions and colors
    const personaConfig: Record<string, { description: string; color: string }> = {
      'anonymous': {
        description: 'Users without authentication - limited or no tool access',
        color: '#6c757d'
      },
      'user': {
        description: 'Regular authenticated users with read-only access to most tools',
        color: '#28a745'
      },
      'admin': {
        description: 'Administrators with full access to all tools including user management',
        color: '#dc3545'
      },
      'operator': {
        description: 'Operators with access to operational and monitoring tools',
        color: '#17a2b8'
      }
    };

    // Calculate stats for each persona
    const personas = Object.entries(allPersonas).map(([personaName, personaTools]) => ({
      name: personaName,
      displayName: personaName.charAt(0).toUpperCase() + personaName.slice(1),
      description: personaConfig[personaName]?.description || `${personaName.charAt(0).toUpperCase() + personaName.slice(1)} persona with specific tool access`,
      tools: filterToolsByPersona(allTools, personaTools),
      color: personaConfig[personaName]?.color || '#6c757d'
    }));

    // Calculate sizes and add to persona data
    const personaStats = personas.map(persona => ({
      ...persona,
      toolCount: persona.tools.length,
      totalSize: persona.tools.reduce((sum, tool) => sum + (tool.size || 0), 0)
    }));

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Personas Overview - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        .navigation {
            margin-bottom: 30px;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 6px 12px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
        }
        .nav-link:hover {
            background-color: #5a6268;
        }
        .persona-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .persona-card {
            border: 2px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            text-decoration: none;
            color: inherit;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .persona-card:hover {
            border-color: #007acc;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            transform: translateY(-2px);
            text-decoration: none;
            color: inherit;
        }
        .persona-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        .persona-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            margin-right: 15px;
            font-size: 1.2em;
        }
        .persona-title {
            font-size: 1.3em;
            font-weight: bold;
            margin: 0;
        }
        .persona-description {
            color: #6c757d;
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .persona-stats {
            display: flex;
            justify-content: space-between;
            background-color: #f8f9fa;
            padding: 10px;
            border-radius: 5px;
        }
        .stat {
            text-align: center;
        }
        .stat-number {
            font-size: 1.5em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            font-size: 0.8em;
            color: #6c757d;
            text-transform: uppercase;
        }
        .summary {
            background-color: #e3f2fd;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .summary h2 {
            margin-top: 0;
            color: #1976d2;
        }
        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin-top: 15px;
        }
        .summary-stat {
            text-align: center;
            background-color: white;
            padding: 15px;
            border-radius: 5px;
        }
        .summary-stat-number {
            font-size: 1.8em;
            font-weight: bold;
            color: #1976d2;
        }
        .summary-stat-label {
            font-size: 0.9em;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Personas Overview</h1>

        <div class="navigation">
            <a href="/tools" class="nav-link">All Tools</a>
            <a href="/export/tools/csv" class="nav-link">Download CSV</a>
        </div>

        <div class="summary">
            <h2>System Summary</h2>
            <p>The AAP MCP system uses personas to control tool access based on user permissions. Each persona provides a different level of access to the available tools.</p>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-stat-number">${allTools.length}</div>
                    <div class="summary-stat-label">Total Tools</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-number">${personas.length}</div>
                    <div class="summary-stat-label">Personas</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-number">${allTools.reduce((sum, tool) => sum + (tool.size || 0), 0).toLocaleString()}</div>
                    <div class="summary-stat-label">Total Characters</div>
                </div>
            </div>
        </div>

        <div class="persona-grid">
            ${personaStats.map(persona => `
            <a href="/persona/${persona.name}" class="persona-card">
                <div class="persona-header">
                    <div class="persona-icon" style="background-color: ${persona.color};">
                        ${persona.displayName.charAt(0)}
                    </div>
                    <h3 class="persona-title">${persona.displayName}</h3>
                </div>
                <p class="persona-description">${persona.description}</p>
                <div class="persona-stats">
                    <div class="stat">
                        <div class="stat-number">${persona.toolCount}</div>
                        <div class="stat-label">Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${persona.totalSize.toLocaleString()}</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
            </a>
            `).join('')}
        </div>
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating persona overview:', error);
    res.status(500).json({
      error: 'Failed to generate persona overview',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Persona tools endpoint
app.get('/persona/:name', (req, res) => {
  try {
    const personaName = req.params.name.toLowerCase();

    // Get the persona based on the name
    const persona = allPersonas[personaName];
    if (!persona) {
      const availablePersonas = Object.keys(allPersonas).join(', ');
      return res.status(404).json({
        error: 'Persona not found',
        message: `Persona '${req.params.name}' does not exist. Available personas: ${availablePersonas}`
      });
    }

    const displayName = personaName.charAt(0).toUpperCase() + personaName.slice(1);

    // Filter tools based on persona
    const filteredTools = filterToolsByPersona(allTools, persona);

    // Calculate total size
    const totalSize = filteredTools.reduce((sum, tool) => sum + (tool.size || 0), 0);

    // Generate HTML response
    const toolRows = filteredTools.map(tool => `
      <tr>
        <td><a href="/tools/${encodeURIComponent(tool.name)}" style="color: #007acc; text-decoration: none;">${tool.name}</a></td>
        <td>${tool.size}</td>
        <td>${tool.description || ''}</td>
        <td><code>${tool.pathTemplate}</code></td>
        <td><span class="service-${tool.service || 'unknown'}">${tool.service || 'unknown'}</span></td>
      </tr>
    `).join('');

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${displayName} Persona Tools - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
        }
        .persona-badge {
            display: inline-block;
            background-color: #007acc;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-left: 10px;
        }
        .stats {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .navigation {
            margin-bottom: 20px;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 6px 12px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
        }
        .nav-link:hover {
            background-color: #5a6268;
        }
        .nav-link.active {
            background-color: #007acc;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #007acc;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f2f2f2;
        }
        tr:hover {
            background-color: #e6f3ff;
        }
        code {
            background-color: #f4f4f4;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: monospace;
        }
        .service-eda { background-color: #e3f2fd; padding: 3px 6px; border-radius: 3px; }
        .service-controller { background-color: #f3e5f5; padding: 3px 6px; border-radius: 3px; }
        .service-gateway { background-color: #e8f5e8; padding: 3px 6px; border-radius: 3px; }
        .service-galaxy { background-color: #fff3e0; padding: 3px 6px; border-radius: 3px; }
        .service-unknown { background-color: #ffebee; padding: 3px 6px; border-radius: 3px; }
        .service-operator { background-color: #e1f5fe; padding: 3px 6px; border-radius: 3px; }
        .actions {
            margin-bottom: 20px;
        }
        .btn {
            background-color: #007acc;
            color: white;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
        }
        .btn:hover {
            background-color: #005a9e;
        }
        .empty-state {
            text-align: center;
            color: #6c757d;
            padding: 40px;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${displayName} Persona Tools<span class="persona-badge">${filteredTools.length} tools</span></h1>

        <div class="navigation">
            ${Object.keys(allPersonas).map(name => `
            <a href="/persona/${name}" class="nav-link ${personaName === name ? 'active' : ''}">${name.charAt(0).toUpperCase() + name.slice(1)}</a>
            `).join('')}
            <a href="/tools" class="nav-link">All Tools</a>
        </div>

        <div class="stats">
            <strong>Persona:</strong> ${displayName}<br>
            <strong>Available Tools:</strong> ${filteredTools.length}<br>
            <strong>Total Size:</strong> ${totalSize.toLocaleString()} characters
        </div>

        ${filteredTools.length === 0 ? `
        <div class="empty-state">
            <p>No tools are available for the ${displayName} persona.</p>
        </div>
        ` : `
        <div class="actions">
            <a href="/export/tools/csv" class="btn">Download All Tools CSV</a>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Tool Name</th>
                    <th>Size (chars)</th>
                    <th>Description</th>
                    <th>Path Template</th>
                    <th>Service</th>
                </tr>
            </thead>
            <tbody>
                ${toolRows}
            </tbody>
        </table>
        `}
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating persona tool list:', error);
    res.status(500).json({
      error: 'Failed to generate persona tool list',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Services overview endpoint
app.get('/services', (req, res) => {
  try {
    // Group tools by service
    const serviceMap: Record<string, ToolWithSize[]> = {};

    for (const tool of allTools) {
      const service = tool.service || 'unknown';
      if (!serviceMap[service]) {
        serviceMap[service] = [];
      }
      serviceMap[service].push(tool);
    }

    // Calculate service statistics
    const services = Object.entries(serviceMap).map(([serviceName, tools]) => {
      const totalSize = tools.reduce((sum, tool) => sum + (tool.size || 0), 0);
      const methods = [...new Set(tools.map(tool => tool.method.toUpperCase()))];

      return {
        name: serviceName,
        displayName: serviceName.charAt(0).toUpperCase() + serviceName.slice(1),
        toolCount: tools.length,
        totalSize,
        methods: methods.sort(),
        tools
      };
    }).sort((a, b) => b.toolCount - a.toolCount); // Sort by tool count descending

    const serviceColors: Record<string, string> = {
      'eda': '#2196f3',
      'controller': '#9c27b0',
      'gateway': '#4caf50',
      'galaxy': '#ff9800',
      'unknown': '#f44336'
    };

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Services Overview - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        .navigation {
            margin-bottom: 30px;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 6px 12px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
        }
        .nav-link:hover {
            background-color: #5a6268;
        }
        .services-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .service-card {
            border: 2px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            text-decoration: none;
            color: inherit;
            transition: all 0.3s ease;
            cursor: pointer;
            background-color: white;
        }
        .service-card:hover {
            border-color: #007acc;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            transform: translateY(-2px);
            text-decoration: none;
            color: inherit;
        }
        .service-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        .service-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            margin-right: 15px;
            font-size: 1.2em;
        }
        .service-title {
            font-size: 1.3em;
            font-weight: bold;
            margin: 0;
        }
        .service-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
            gap: 10px;
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 15px;
        }
        .stat {
            text-align: center;
        }
        .stat-number {
            font-size: 1.2em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            font-size: 0.8em;
            color: #6c757d;
            text-transform: uppercase;
        }
        .methods-list {
            display: flex;
            gap: 5px;
            flex-wrap: wrap;
        }
        .method-badge {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.7em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .method-get { background-color: #28a745; color: white; }
        .method-post { background-color: #007bff; color: white; }
        .method-put { background-color: #ffc107; color: black; }
        .method-patch { background-color: #6f42c1; color: white; }
        .method-delete { background-color: #dc3545; color: white; }
        .summary {
            background-color: #e3f2fd;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .summary h2 {
            margin-top: 0;
            color: #1976d2;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Services Overview</h1>

        <div class="navigation">
            <a href="/" class="nav-link">Dashboard</a>
            <a href="/tools" class="nav-link">All Tools</a>
            <a href="/persona" class="nav-link">Personas</a>
        </div>

        <div class="summary">
            <h2>Available Services</h2>
            <p>The AAP MCP system integrates with ${services.length} different services, providing access to ${allTools.length} total tools across the Ansible Automation Platform ecosystem.</p>
        </div>

        <div class="services-grid">
            ${services.map(service => `
            <a href="/services/${service.name}" class="service-card">
                <div class="service-header">
                    <div class="service-icon" style="background-color: ${serviceColors[service.name] || '#6c757d'};">
                        ${service.displayName.charAt(0)}
                    </div>
                    <h3 class="service-title">${service.displayName}</h3>
                </div>
                <div class="service-stats">
                    <div class="stat">
                        <div class="stat-number">${service.toolCount}</div>
                        <div class="stat-label">Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(service.totalSize / 1000)}K</div>
                        <div class="stat-label">Size</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${service.methods.length}</div>
                        <div class="stat-label">Methods</div>
                    </div>
                </div>
                <div class="methods-list">
                    ${service.methods.map(method => `
                    <span class="method-badge method-${method.toLowerCase()}">${method}</span>
                    `).join('')}
                </div>
            </a>
            `).join('')}
        </div>
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating services overview:', error);
    res.status(500).json({
      error: 'Failed to generate services overview',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Individual service details endpoint
app.get('/services/:name', (req, res) => {
  try {
    const serviceName = req.params.name.toLowerCase();

    // Find tools for this service
    const serviceTools = allTools.filter(tool => (tool.service || 'unknown') === serviceName);

    if (serviceTools.length === 0) {
      const availableServices = [...new Set(allTools.map(tool => tool.service || 'unknown'))];
      return res.status(404).json({
        error: 'Service not found',
        message: `Service '${req.params.name}' does not exist. Available services: ${availableServices.join(', ')}`
      });
    }

    const displayName = serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
    const totalSize = serviceTools.reduce((sum, tool) => sum + (tool.size || 0), 0);
    const methods = [...new Set(serviceTools.map(tool => tool.method.toUpperCase()))].sort();

    // Group tools by HTTP method
    const toolsByMethod: Record<string, ToolWithSize[]> = {};
    for (const tool of serviceTools) {
      const method = tool.method.toUpperCase();
      if (!toolsByMethod[method]) {
        toolsByMethod[method] = [];
      }
      toolsByMethod[method].push(tool);
    }

    const serviceColors: Record<string, string> = {
      'eda': '#2196f3',
      'controller': '#9c27b0',
      'gateway': '#4caf50',
      'galaxy': '#ff9800',
      'unknown': '#f44336'
    };

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${displayName} Service - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        .service-badge {
            display: inline-block;
            background-color: ${serviceColors[serviceName] || '#6c757d'};
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-left: 10px;
        }
        .navigation {
            margin-bottom: 30px;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 6px 12px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
        }
        .nav-link:hover {
            background-color: #5a6268;
        }
        .stats {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .methods-section {
            margin-bottom: 30px;
        }
        .method-group {
            margin-bottom: 20px;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            overflow: hidden;
        }
        .method-header {
            padding: 15px;
            font-weight: bold;
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .method-get { background-color: #28a745; }
        .method-post { background-color: #007bff; }
        .method-put { background-color: #ffc107; color: black; }
        .method-patch { background-color: #6f42c1; }
        .method-delete { background-color: #dc3545; }
        .tools-list {
            padding: 0;
            margin: 0;
            list-style: none;
        }
        .tool-item {
            padding: 10px 15px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tool-item:last-child {
            border-bottom: none;
        }
        .tool-item:hover {
            background-color: #f8f9fa;
        }
        .tool-name {
            font-weight: bold;
            color: #007acc;
            text-decoration: none;
        }
        .tool-name:hover {
            text-decoration: underline;
        }
        .tool-size {
            font-size: 0.9em;
            color: #6c757d;
        }
        .method-count {
            background-color: rgba(255,255,255,0.3);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.8em;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${displayName} Service<span class="service-badge">${serviceTools.length} tools</span></h1>

        <div class="navigation">
            <a href="/" class="nav-link">Dashboard</a>
            <a href="/services" class="nav-link">All Services</a>
            <a href="/tools" class="nav-link">All Tools</a>
            <a href="/persona" class="nav-link">Personas</a>
        </div>

        <div class="stats">
            <strong>Service:</strong> ${displayName}<br>
            <strong>Total Tools:</strong> ${serviceTools.length}<br>
            <strong>Total Size:</strong> ${totalSize.toLocaleString()} characters<br>
            <strong>HTTP Methods:</strong> ${methods.join(', ')}
        </div>

        <div class="methods-section">
            <h2>Tools by HTTP Method</h2>
            ${Object.entries(toolsByMethod).sort().map(([method, tools]) => `
            <div class="method-group">
                <div class="method-header method-${method.toLowerCase()}">
                    <span>${method}</span>
                    <span class="method-count">${tools.length} tools</span>
                </div>
                <ul class="tools-list">
                    ${tools.map(tool => `
                    <li class="tool-item">
                        <a href="/tools/${encodeURIComponent(tool.name)}" class="tool-name">${tool.name}</a>
                        <span class="tool-size">${tool.size.toLocaleString()} chars</span>
                    </li>
                    `).join('')}
                </ul>
            </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating service details:', error);
    res.status(500).json({
      error: 'Failed to generate service details',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Root endpoint - dashboard
app.get('/', (req, res) => {
  try {
    // Calculate summary statistics
    const totalSize = allTools.reduce((sum, tool) => sum + (tool.size || 0), 0);

    // Calculate persona statistics dynamically
    const personaStats: Record<string, { tools: ToolWithSize[]; size: number }> = {};
    for (const [personaName, personaTools] of Object.entries(allPersonas)) {
      const tools = filterToolsByPersona(allTools, personaTools);
      personaStats[personaName] = {
        tools,
        size: tools.reduce((sum, tool) => sum + (tool.size || 0), 0)
      };
    }

    // Count tools by service
    const serviceStats = allTools.reduce((acc, tool) => {
      const service = tool.service || 'unknown';
      acc[service] = (acc[service] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AAP MCP Dashboard</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
        }
        .header h1 {
            font-size: 3em;
            margin: 0;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
            margin: 10px 0;
        }
        .main-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }
        .card {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        }
        .card-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
        }
        .card-icon {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5em;
            font-weight: bold;
            margin-right: 20px;
        }
        .tools-icon { background: linear-gradient(45deg, #007acc, #0056b3); }
        .personas-icon { background: linear-gradient(45deg, #28a745, #1e7e34); }
        .card-title {
            font-size: 1.8em;
            font-weight: bold;
            color: #333;
            margin: 0;
        }
        .card-description {
            color: #666;
            margin-bottom: 25px;
            line-height: 1.6;
        }
        .card-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat {
            text-align: center;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .stat-number {
            font-size: 1.5em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            font-size: 0.8em;
            color: #666;
            text-transform: uppercase;
            margin-top: 5px;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(45deg, #007acc, #0056b3);
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            transition: all 0.3s ease;
            text-align: center;
        }
        .btn:hover {
            background: linear-gradient(45deg, #0056b3, #004085);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,123,204,0.4);
            text-decoration: none;
            color: white;
        }
        .btn-personas {
            background: linear-gradient(45deg, #28a745, #1e7e34);
        }
        .btn-personas:hover {
            background: linear-gradient(45deg, #1e7e34, #155724);
            box-shadow: 0 5px 15px rgba(40,167,69,0.4);
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .summary-card {
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 20px;
            color: white;
            text-align: center;
        }
        .summary-card h3 {
            margin-top: 0;
            font-size: 1.1em;
            opacity: 0.9;
        }
        .summary-number {
            font-size: 2em;
            font-weight: bold;
            margin: 10px 0;
        }
        .service-stats {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .service-badge {
            padding: 5px 12px;
            border-radius: 15px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .service-eda { background: #2196f3; color: white; }
        .service-controller { background: #9c27b0; color: white; }
        .service-gateway { background: #4caf50; color: white; }
        .service-galaxy { background: #ff9800; color: white; }
        .service-unknown { background: #f44336; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>AAP MCP Dashboard</h1>
            <p>Ansible Automation Platform Model Context Protocol Interface</p>
        </div>

        <div class="summary-grid">
            <div class="summary-card">
                <h3>Total Tools</h3>
                <div class="summary-number">${allTools.length}</div>
            </div>
            <div class="summary-card">
                <h3>Total Size</h3>
                <div class="summary-number">${Math.round(totalSize / 1000)}K</div>
                <small>characters</small>
            </div>
            <div class="summary-card">
                <h3>Services</h3>
                <div class="summary-number">${Object.keys(serviceStats).length}</div>
            </div>
            <div class="summary-card">
                <h3>Personas</h3>
                <div class="summary-number">${Object.keys(allPersonas).length}</div>
            </div>
        </div>

        <div class="main-grid">
            <div class="card">
                <div class="card-header">
                    <div class="card-icon tools-icon">🔧</div>
                    <h2 class="card-title">Tools</h2>
                </div>
                <p class="card-description">
                    Browse and explore all available MCP tools. Each tool provides access to specific AAP functionality across different services including EDA, Controller, Gateway, and Galaxy.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${allTools.length}</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(totalSize / 1000)}K</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
                <div class="service-stats">
                    ${Object.entries(serviceStats).map(([service, count]) =>
                        `<span class="service-badge service-${service}">${service}: ${count}</span>`
                    ).join('')}
                </div>
                <br><br>
                <a href="/tools" class="btn">Browse All Tools</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background: linear-gradient(45deg, #ff6b6b, #ee5a24);">🏗️</div>
                    <h2 class="card-title">Services</h2>
                </div>
                <p class="card-description">
                    Explore the different AAP services that provide the tools. Each service represents a different component of the Ansible Automation Platform ecosystem.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${allTools.length}</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(totalSize / 1000)}K</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
                <div class="service-stats">
                    ${Object.entries(serviceStats).map(([service, count]) =>
                        `<span class="service-badge service-${service}">${service}: ${count}</span>`
                    ).join('')}
                </div>
                <br><br>
                <a href="/services" class="btn" style="background: linear-gradient(45deg, #ff6b6b, #ee5a24);">Explore Services</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon personas-icon">👥</div>
                    <h2 class="card-title">Personas</h2>
                </div>
                <p class="card-description">
                    Understand the different user personas and their tool access levels. Personas control which tools are available based on user permissions and authentication status.
                </p>
                <div class="card-stats">
                    ${Object.entries(personaStats).map(([personaName, stats]) => `
                    <div class="stat">
                        <div class="stat-number">${stats.tools.length} tools</div>
                        <div class="stat-label">${personaName.charAt(0).toUpperCase() + personaName.slice(1)}</div>
                    </div>
                    `).join('')}
                </div>
                <br>
                <a href="/persona" class="btn btn-personas">Explore Personas</a>
            </div>
        </div>
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating dashboard:', error);
    res.status(500).json({
      error: 'Failed to generate dashboard',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

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
    console.log('\n=== Persona Size Summary ===');
    for (const [personaName, personaTools] of Object.entries(allPersonas)) {
      const tools = filterToolsByPersona(allTools, personaTools);
      const size = tools.reduce((sum, tool) => sum + (tool.size || 0), 0);
      console.log(`${personaName.charAt(0).toUpperCase() + personaName.slice(1)}: ${tools.length} tools, ${size.toLocaleString()} characters`);
    }
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
