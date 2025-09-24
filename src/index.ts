#!/usr/bin/env node

import { config } from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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
    console.error("Error loading OpenAPI specs:", error);
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
        baseUrl: "http://localhost:44926"
      });
      allTools = allTools.concat(tools);
    } catch (error) {
      console.error("Error generating tools from OpenAPI spec:", error);
    }
  }

  return allTools;
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

async function main() {
  // Initialize tools before starting server
  allTools = await generateTools();
  console.error(`Loaded ${allTools.length} tools from OpenAPI specifications`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});