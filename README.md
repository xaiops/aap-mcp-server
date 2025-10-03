# AAP MCP Service

A Model Context Protocol (MCP) service that provides access to Ansible Automation Platform (AAP) APIs through OpenAPI specifications.

## Prerequisites

- Node.js 18 or higher
- Access to an Ansible Automation Platform instance
- Valid AAP authentication token

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd poc-aap-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory with the following configuration:

```bash
# AAP Gateway Authentication token (required)
BEARER_TOKEN_OAUTH2_AUTHENTICATION=your_aap_token_here

# MCP server port (optional, defaults to 3000)
MCP_PORT=3000
```

### AAP Base URL

The service defaults to `http://localhost:44926` as the AAP base URL. To change this, modify the `BASE_URL` constant in `src/index.ts:24`.

### User Personas

The service supports three user personas that determine which tools are available:

- **Anonymous**: No tools available (default for unauthenticated users)
- **User**: Limited set of read-only tools for EDA, Controller, and Galaxy services
- **Admin**: Full access to all tools including create, update, and delete operations

Personas are automatically determined based on user permissions from the AAP token, but can be overridden using persona-specific endpoints.

## Usage

### Starting the Service

```bash
# Development mode
npm run dev

# Production mode
npm start
```

### MCP Endpoints

The service provides several endpoints:

- **Standard MCP**: `/mcp` (POST, GET, DELETE)
- **Persona-specific**: `/{persona}/mcp` where persona is `anonymous`, `user`, or `admin`

### Authentication

Include your AAP token in the Authorization header:

```
Authorization: Bearer your_aap_token_here
```

### Session Management

The service uses session-based authentication:

1. Initialize a session with a POST request containing your token
2. Use the returned `Mcp-Session-Id` header for subsequent requests
3. The service validates tokens and determines user permissions automatically

### Connecting to Claude

#### Option 1: Token in Authorization Header

```bash
claude mcp add poc-aap-mcp -t http http://localhost:3000/mcp -H 'Authorization: Bearer your_aap_token_here'
```

#### Option 2: Token in Environment Variable

1. Configure the token in `.env`:
```bash
BEARER_TOKEN_OAUTH2_AUTHENTICATION=your_aap_token_here
```

2. Start the service:
```bash
npm run dev
```

3. Register with Claude:
```bash
claude mcp add poc-aap-mcp -t http http://localhost:3000/mcp
```

#### Option 3: Force Specific Persona

To override automatic persona detection:

```bash
# Force admin persona
claude mcp add poc-aap-mcp -t http http://localhost:3000/admin/mcp

# Force user persona
claude mcp add poc-aap-mcp -t http http://localhost:3000/user/mcp

# Force anonymous persona (no auth required)
claude mcp add poc-aap-mcp -t http http://localhost:3000/anonymous/mcp
```

## Available Tools

The service generates tools from AAP OpenAPI specifications for:

- **EDA** (Event-Driven Ansible): Activations, projects, rulebooks, decision environments
- **Controller**: Jobs, job templates, inventories, projects, organizations
- **Gateway**: User and team management, organizations, role definitions
- **Galaxy**: Collection management and versions

Tool availability depends on your user persona. A complete list of tools with sizes is generated in `tool_list.csv` when the service starts.

## Development

### Project Structure

- `src/index.ts`: Main service implementation
- `.env`: Environment configuration
- `package.json`: Dependencies and scripts
- `tool_list.csv`: Generated tool list (created at runtime)

### Key Features

- Automatic OpenAPI specification loading from AAP services
- Role-based access control through user personas
- Session management with token validation
- Tool filtering based on user permissions
- CORS support for web clients

### Adding New Services

To add support for additional AAP services:

1. Add the OpenAPI specification URL to the `specUrls` array in `loadOpenApiSpecs()`
2. Implement a `reformatFunc` to standardize tool names and paths
3. Update the persona definitions to include relevant tools

## Troubleshooting

### Common Issues

1. **Authentication failed**: Verify your AAP token is valid and has appropriate permissions
2. **No tools available**: Check that your token provides the expected user permissions
3. **Connection refused**: Ensure AAP is running and accessible at the configured base URL
4. **Missing dependencies**: Run `npm install` to install required packages

### Logs

The service provides detailed console logging for:
- OpenAPI specification loading
- Session initialization and cleanup
- Tool filtering by persona
- API request execution

## License

GPL-3.0-or-later
