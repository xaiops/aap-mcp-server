# OpenShift Deployment Guide for AAP MCP Server

This guide will help you containerize and deploy the AAP MCP Server to OpenShift in the `aap-mcp-server` namespace.

## Quick Start

### 1. Build the Container Image

The Containerfile uses a multi-stage build with Red Hat UBI9 Node.js 20 base image.

#### Option A: Build with Podman (Recommended for local testing)

```bash
# From the repository root
podman build -f Containerfile -t aap-mcp-server:latest .
```

#### Option B: Build using OpenShift Build

```bash
# Create image stream
oc create imagestream aap-mcp-server -n aap-mcp-server

# Start build from source
oc new-build --name aap-mcp-server \
  --strategy docker \
  --binary \
  --docker-image registry.access.redhat.com/ubi9/nodejs-20:latest \
  -n aap-mcp-server

oc start-build aap-mcp-server --from-dir=. --follow -n aap-mcp-server
```

### 2. Push Image to Registry

If using an external registry:

```bash
# Tag and push
podman tag aap-mcp-server:latest <your-registry>/aap-mcp-server:latest
podman push <your-registry>/aap-mcp-server:latest

# Update deployment.yaml to reference your registry image
```

### 3. Create Secrets

Create the secret for AAP authentication token:

```bash
oc create secret generic aap-mcp-secrets \
  --from-literal=bearer-token='YOUR_AAP_TOKEN_HERE' \
  -n aap-mcp-server
```

### 4. Update Configuration

Edit `kubernetes/configmap.yaml` to set your AAP base URL and other configurations, or set via environment variables in the deployment.

### 5. Deploy

```bash
cd kubernetes
oc apply -f .
```

Or apply individually:

```bash
oc apply -f kubernetes/serviceaccount.yaml
oc apply -f kubernetes/configmap.yaml
oc apply -f kubernetes/deployment.yaml
oc apply -f kubernetes/service.yaml
oc apply -f kubernetes/route.yaml
```

### 6. Verify Deployment

```bash
# Check deployment status
oc get deployment aap-mcp-server -n aap-mcp-server

# Check pods
oc get pods -n aap-mcp-server

# View logs
oc logs -f deployment/aap-mcp-server -n aap-mcp-server

# Get route URL
oc get route aap-mcp-server -n aap-mcp-server
```

## Important Notes

### Dependencies

All required dependencies are now listed in `package.json`. If you make changes, ensure you run:

```bash
npm install
```

### Configuration Priority

Configuration is loaded in this order (highest to lowest priority):
1. Environment variables (set in deployment.yaml)
2. ConfigMap (aap-mcp.yaml)
3. Default values

### Base URL Configuration

You can set the AAP base URL in multiple ways:
1. Environment variable `BASE_URL` in deployment.yaml (recommended)
2. `base_url` in ConfigMap
3. Default: `https://localhost`

## Files Created

- `Containerfile` - Multi-stage Docker/Containerfile for building the image
- `.dockerignore` - Optimizes build context
- `kubernetes/configmap.yaml` - Configuration for the application
- `kubernetes/deployment.yaml` - OpenShift Deployment manifest
- `kubernetes/service.yaml` - Kubernetes Service manifest
- `kubernetes/route.yaml` - OpenShift Route for external access
- `kubernetes/serviceaccount.yaml` - ServiceAccount for the deployment
- `kubernetes/secret-template.yaml` - Template for secrets (for reference)
- `kubernetes/kustomization.yaml` - Kustomize configuration
- `kubernetes/README.md` - Detailed deployment documentation

## Troubleshooting

### Build Issues

If the build fails, check:
- Node.js dependencies are correctly listed
- TypeScript compiles successfully (`npm run build`)
- All required files are included in the build context

### Runtime Issues

If pods fail to start:
- Check logs: `oc logs <pod-name> -n aap-mcp-server`
- Verify secrets exist: `oc get secret aap-mcp-secrets -n aap-mcp-server`
- Check ConfigMap: `oc describe configmap aap-mcp-config -n aap-mcp-server`
- Verify image is accessible: `oc describe pod <pod-name> -n aap-mcp-server`

### Configuration Issues

- Ensure `aap-mcp.yaml` is properly formatted YAML
- Check that service paths in config match actual data files
- Verify categories are correctly defined

## Next Steps

1. Review and customize `kubernetes/configmap.yaml` for your environment
2. Set up proper image registry access
3. Configure secrets management (consider Sealed Secrets)
4. Set up monitoring and logging
5. Configure resource limits based on expected load
6. Set up backup for logs if `record_api_queries` is enabled

For detailed information, see `kubernetes/README.md`.

