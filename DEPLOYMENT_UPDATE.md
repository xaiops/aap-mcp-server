# Updating AAP MCP Server Deployment on OpenShift

This guide will help you update your existing AAP MCP Server deployment with the latest token handling fixes.

## Quick Update Steps

### Option 1: Automated Update Script

```bash
# Make the script executable (if not already)
chmod +x update-deployment.sh

# Run the update script
./update-deployment.sh [image-tag]

# Example with specific tag:
./update-deployment.sh v1.0.1
```

### Option 2: Manual Update Steps

#### 1. Build the New Image

```bash
# Build the image with your changes
podman build -f Containerfile -t quay.io/chrhamme/aap-mcp-server:latest .

# Or with a version tag
podman build -f Containerfile -t quay.io/chrhamme/aap-mcp-server:v1.0.1 .
```

#### 2. Push to Registry

```bash
# Push the image
podman push quay.io/chrhamme/aap-mcp-server:latest

# Or with version tag
podman push quay.io/chrhamme/aap-mcp-server:v1.0.1
```

#### 3. Update the Deployment

```bash
# Switch to your namespace
oc project aap-mcp-server

# Update the deployment with the new image
oc set image deployment/aap-mcp-server aap-mcp-server=quay.io/chrhamme/aap-mcp-server:latest -n aap-mcp-server

# Or with version tag
oc set image deployment/aap-mcp-server aap-mcp-server=quay.io/chrhamme/aap-mcp-server:v1.0.1 -n aap-mcp-server
```

#### 4. Watch the Rollout

```bash
# Watch the rollout status
oc rollout status deployment/aap-mcp-server -n aap-mcp-server --timeout=5m

# Or watch pods directly
oc get pods -l app=aap-mcp-server -n aap-mcp-server -w
```

#### 5. Verify the Update

```bash
# Check deployment status
oc get deployment aap-mcp-server -n aap-mcp-server

# View recent logs to verify token handling
oc logs -l app=aap-mcp-server -n aap-mcp-server --tail=50

# Check for any errors
oc logs -l app=aap-mcp-server -n aap-mcp-server | grep -i "token\|error"
```

## What Changed?

The update includes improved token handling:

1. **Fallback Token Support**: If no token is provided in the Authorization header during session initialization, the server will automatically use the `BEARER_TOKEN_OAUTH2_AUTHENTICATION` environment variable.

2. **Better Error Messages**: Clear error messages if no token is available at all.

3. **Session Token Storage**: Tokens are now properly validated and stored during session initialization, preventing "No stored tokens found" errors.

## Verification Checklist

After deployment, verify:

- [ ] Pods are running: `oc get pods -n aap-mcp-server`
- [ ] No token-related errors in logs: `oc logs -l app=aap-mcp-server -n aap-mcp-server | grep -i token`
- [ ] Health endpoint responds: `curl https://$(oc get route aap-mcp-server -n aap-mcp-server -o jsonpath='{.spec.host}')/api/v1/health`
- [ ] Sessions initialize properly (check logs for "Session initialized" messages)

## Troubleshooting

### If pods fail to start:

```bash
# Check pod events
oc describe pod <pod-name> -n aap-mcp-server

# Check logs
oc logs <pod-name> -n aap-mcp-server
```

### If token validation fails:

1. Verify the secret exists and is correct:
   ```bash
   oc get secret aap-mcp-secrets -n aap-mcp-server -o jsonpath='{.data.bearer-token}' | base64 -d
   ```

2. Check the BASE_URL is correct:
   ```bash
   oc get configmap aap-mcp-config -n aap-mcp-server -o yaml
   ```

3. Verify the token is valid by testing it directly:
   ```bash
   TOKEN=$(oc get secret aap-mcp-secrets -n aap-mcp-server -o jsonpath='{.data.bearer-token}' | base64 -d)
   BASE_URL=$(oc get configmap aap-mcp-config -n aap-mcp-server -o jsonpath='{.data.base_url}')
   curl -H "Authorization: Bearer $TOKEN" "${BASE_URL}/api/gateway/v1/me/"
   ```

### Rollback if needed:

```bash
# Rollback to previous deployment
oc rollout undo deployment/aap-mcp-server -n aap-mcp-server

# Or rollback to specific revision
oc rollout undo deployment/aap-mcp-server --to-revision=<revision-number> -n aap-mcp-server

# Check rollout history
oc rollout history deployment/aap-mcp-server -n aap-mcp-server
```

## Next Steps

After successful deployment:

1. Test the MCP endpoints to ensure token handling works correctly
2. Monitor logs for any token-related issues
3. Verify that sessions initialize without timeouts
4. Test SSE stream connections

## Additional Notes

- The deployment uses `imagePullPolicy: Always`, so it will always pull the latest image
- If you want to use a specific version, tag your image accordingly and update the deployment
- The secret `aap-mcp-secrets` contains the bearer token - ensure it's set correctly
- The ConfigMap `aap-mcp-config` contains the `aap-mcp.yaml` configuration

