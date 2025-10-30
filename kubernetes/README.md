# OpenShift Deployment for AAP MCP Server

This directory contains Kubernetes/OpenShift manifests for deploying the AAP MCP Server.

## Prerequisites

- OpenShift cluster access with cluster-admin or namespace admin permissions
- Access to the `aap-mcp-server` namespace
- An AAP authentication token

## Deployment Steps

### 1. Create the Namespace (if it doesn't exist)

```bash
oc create namespace aap-mcp-server
```

### 2. Build and Push the Container Image

You'll need to build the container image and push it to a registry accessible by your OpenShift cluster.

#### Option A: Using OpenShift's Internal Registry

```bash
# Login to OpenShift
oc login <your-cluster-url>

# Create an image stream
oc create imagestream aap-mcp-server -n aap-mcp-server

# Build the image using OpenShift Build
oc new-build --name aap-mcp-server \
  --strategy docker \
  --binary \
  --docker-image registry.access.redhat.com/ubi9/nodejs-20:latest \
  -n aap-mcp-server

# Start the build
oc start-build aap-mcp-server --from-dir=. --follow -n aap-mcp-server

# Tag the image
oc tag aap-mcp-server:latest aap-mcp-server:latest -n aap-mcp-server
```

#### Option B: Using External Registry (Podman/Docker)

```bash
# Build the image
podman build -f Containerfile -t aap-mcp-server:latest .

# Tag for your registry
podman tag aap-mcp-server:latest <your-registry>/aap-mcp-server:latest

# Push to registry
podman push <your-registry>/aap-mcp-server:latest

# Create image pull secret if needed
oc create secret docker-registry registry-secret \
  --docker-server=<your-registry> \
  --docker-username=<username> \
  --docker-password=<password> \
  --docker-email=<email> \
  -n aap-mcp-server

# Update deployment.yaml to use your image and imagePullSecrets
```

### 3. Create the Secret for AAP Token

```bash
oc create secret generic aap-mcp-secrets \
  --from-literal=bearer-token='your-aap-token-here' \
  -n aap-mcp-server
```

**Important**: Replace `your-aap-token-here` with your actual AAP authentication token.

### 4. Update Configuration

Edit `configmap.yaml` to configure:
- Base URL for your AAP instance (or set via `BASE_URL` environment variable)
- Service configurations
- Tool categories
- Feature flags (UI, logging, etc.)

### 5. Deploy to OpenShift

#### Option A: Apply all manifests individually

```bash
oc apply -f serviceaccount.yaml
oc apply -f configmap.yaml
oc apply -f deployment.yaml
oc apply -f service.yaml
oc apply -f route.yaml
```

#### Option B: Apply all at once

```bash
oc apply -f .
```

#### Option C: Using Kustomize

```bash
oc apply -k .
```

### 6. Verify Deployment

```bash
# Check pods
oc get pods -n aap-mcp-server

# Check deployment status
oc get deployment aap-mcp-server -n aap-mcp-server

# View logs
oc logs -f deployment/aap-mcp-server -n aap-mcp-server

# Get route URL
oc get route aap-mcp-server -n aap-mcp-server
```

### 7. Access the Service

Once deployed, you can access the service via the Route:

```bash
ROUTE_URL=$(oc get route aap-mcp-server -n aap-mcp-server -o jsonpath='{.spec.host}')
echo "Service available at: https://${ROUTE_URL}"
```

## Configuration

### Environment Variables

The following environment variables can be set in the deployment:

- `BASE_URL`: AAP instance base URL (highest priority)
- `MCP_PORT`: Server port (default: 3000)
- `BEARER_TOKEN_OAUTH2_AUTHENTICATION`: AAP authentication token (from Secret)
- `RECORD_API_QUERIES`: Enable API query logging (true/false)
- `IGNORE_CERTIFICATE_ERRORS`: Disable HTTPS certificate validation (true/false)
- `ENABLE_UI`: Enable web UI dashboard (true/false)

### ConfigMap

The ConfigMap (`aap-mcp-config`) contains the `aap-mcp.yaml` configuration file. You can update it:

```bash
oc edit configmap aap-mcp-config -n aap-mcp-server
```

After editing, restart the pods to pick up changes:

```bash
oc rollout restart deployment/aap-mcp-server -n aap-mcp-server
```

### Secrets

The Secret (`aap-mcp-secrets`) contains sensitive information like the bearer token. Update it:

```bash
oc create secret generic aap-mcp-secrets \
  --from-literal=bearer-token='new-token' \
  --dry-run=client -o yaml | oc apply -f - -n aap-mcp-server

# Restart deployment to pick up new secret
oc rollout restart deployment/aap-mcp-server -n aap-mcp-server
```

## Scaling

To scale the deployment:

```bash
oc scale deployment/aap-mcp-server --replicas=3 -n aap-mcp-server
```

## Troubleshooting

### Check Pod Status

```bash
oc describe pod <pod-name> -n aap-mcp-server
```

### View Logs

```bash
oc logs <pod-name> -n aap-mcp-server
oc logs -f deployment/aap-mcp-server -n aap-mcp-server
```

### Check Events

```bash
oc get events -n aap-mcp-server --sort-by='.lastTimestamp'
```

### Debug Container

```bash
oc exec -it <pod-name> -n aap-mcp-server -- /bin/sh
```

### Health Check

```bash
ROUTE_URL=$(oc get route aap-mcp-server -n aap-mcp-server -o jsonpath='{.spec.host}')
curl https://${ROUTE_URL}/api/v1/health
```

## Updating the Deployment

### Update Image

```bash
# After building new image
oc set image deployment/aap-mcp-server aap-mcp-server=<new-image> -n aap-mcp-server
```

### Update ConfigMap

```bash
oc apply -f configmap.yaml -n aap-mcp-server
oc rollout restart deployment/aap-mcp-server -n aap-mcp-server
```

## Cleanup

To remove all resources:

```bash
oc delete all -l app=aap-mcp-server -n aap-mcp-server
oc delete configmap aap-mcp-config -n aap-mcp-server
oc delete secret aap-mcp-secrets -n aap-mcp-server
oc delete serviceaccount aap-mcp-server -n aap-mcp-server
oc delete route aap-mcp-server -n aap-mcp-server
```

Or using kustomize:

```bash
oc delete -k .
```

## Security Considerations

- The deployment runs as non-root user (UID 1001)
- Secrets should be managed securely (consider using Sealed Secrets or External Secrets Operator)
- HTTPS is enforced via Route TLS termination
- Consider network policies to restrict access
- Regularly rotate AAP authentication tokens

