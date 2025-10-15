# Multi-stage build for AAP MCP Service
FROM registry.redhat.io/ubi9/nodejs-22-minimal AS builder

USER root
# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src/ ./src/

RUN npm install

# Build the TypeScript project
RUN npm run build

# Production stage
FROM registry.redhat.io/ubi9/nodejs-22-minimal AS production

USER root
# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Pull the openapi-mcp-generator fork
RUN microdnf install -y git-core
RUN rm -r /app/node_modules/openapi-mcp-generator
RUN git clone https://github.com/goneri/openapi-mcp-generator /app/node_modules/openapi-mcp-generator
RUN cd /app/node_modules/openapi-mcp-generator && npm install && npm run build


# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy the OpenAPIv3 schema files
COPY data/ ./data/

# Switch to non-root user
USER 1000

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV MCP_PORT=3000

# Start the application
CMD ["npm", "start"]
