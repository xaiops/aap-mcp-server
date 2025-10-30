# Multi-stage build for AAP MCP Server
# Stage 1: Build stage
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS builder

# Set working directory
WORKDIR /app

# Fix permissions for npm (UBI9 Node.js image runs as non-root)
USER root
RUN chown -R 1001:0 /app && chmod -R 775 /app
USER 1001

# Copy package files (need root to set ownership)
USER root
COPY package*.json ./
RUN chown -R 1001:0 /app && chmod -R 775 /app
USER 1001

# Install dependencies (including dev dependencies for build)
# Using npm install instead of npm ci for better compatibility across Node versions
RUN npm install

# Copy source code (need root to set ownership)
USER root
COPY tsconfig.json ./
COPY src/ ./src/
COPY data/ ./data/
COPY tools/ ./tools/
RUN chown -R 1001:0 /app && chmod -R 775 /app
USER 1001

# Build the application
RUN npm run build

# Stage 2: Production stage
FROM registry.access.redhat.com/ubi9/nodejs-20:latest

# Set working directory
WORKDIR /app

# Fix permissions for npm
USER root
RUN chown -R 1001:0 /app && chmod -R 775 /app
USER 1001

# Copy package files
USER root
COPY package*.json ./
RUN chown -R 1001:0 /app && chmod -R 775 /app
USER 1001

# Install only production dependencies
# Using npm install instead of npm ci for better compatibility
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy built application from builder stage
USER root
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data

# Copy sample config (will be overridden by ConfigMap in OpenShift)
COPY aap-mcp.sample.yaml ./aap-mcp.yaml

# Create logs directory with proper permissions
# UBI9 Node.js image already has user 1001, no need to create
RUN mkdir -p /app/logs && \
    chown -R 1001:0 /app && \
    chmod -R 755 /app

# Switch to non-root user (UBI9 Node.js image already has user 1001)
USER 1001

# Expose the port
EXPOSE 3000

# Set environment variable for port
ENV MCP_PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/index.js"]

