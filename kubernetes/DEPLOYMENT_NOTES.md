# Deployment Notes

## Security Context Fix

The deployment has been configured to work with OpenShift's `restricted-v2` Security Context Constraint (SCC). 

### Changes Made:
- Removed `runAsUser: 1001` and `fsGroup: 0` from pod-level securityContext
- OpenShift will now automatically assign a UID from the allowed range `[1000880000, 1000889999]`
- The container still runs as non-root (`runAsNonRoot: true`)

### Important: Container Image Compatibility

The container image was built with user 1001, but OpenShift will run it with a different UID. To ensure the container works correctly:

1. **Option 1 (Recommended)**: Rebuild the container to not hardcode the user
   - Modify the Containerfile to use `USER 1000880000` or remove USER directive
   - Ensure all files/directories have proper permissions for any UID

2. **Option 2**: The container may still work if:
   - Files are readable/writable by group/others
   - The /app/logs directory permissions allow writes

3. **Option 3**: Use a different SCC if you need to use UID 1001
   ```bash
   oc adm policy add-scc-to-user anyuid -z aap-mcp-server -n aap-mcp-server
   ```
   ⚠️ **Warning**: This reduces security and may not be allowed by cluster policies

## Image Registry

Before deploying, ensure the container image is available in a registry OpenShift can access:

### Option 1: Push to OpenShift Internal Registry

```bash
# Get the internal registry route
OCP_REGISTRY=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
if [ -z "$OCP_REGISTRY" ]; then
  OCP_REGISTRY=$(oc registry info)
fi

# Tag the image
podman tag aap-mcp-server:latest ${OCP_REGISTRY}/aap-mcp-server/aap-mcp-server:latest

# Login to the registry
podman login -u $(oc whoami) -p $(oc whoami -t) ${OCP_REGISTRY}

# Push the image
podman push ${OCP_REGISTRY}/aap-mcp-server/aap-mcp-server:latest

# Update deployment to use the internal registry image
oc set image deployment/aap-mcp-server aap-mcp-server=${OCP_REGISTRY}/aap-mcp-server/aap-mcp-server:latest -n aap-mcp-server
```

### Option 2: Build in OpenShift

```bash
# Create ImageStream
oc create imagestream aap-mcp-server -n aap-mcp-server

# Build from local source
oc new-build --name aap-mcp-server \
  --strategy docker \
  --binary \
  --docker-image registry.access.redhat.com/ubi9/nodejs-20:latest \
  -n aap-mcp-server

oc start-build aap-mcp-server --from-dir=.. --follow -n aap-mcp-server

# Update deployment to use the built image
oc set image deployment/aap-mcp-server aap-mcp-server=aap-mcp-server:latest -n aap-mcp-server
```

### Option 3: External Registry

```bash
# Tag and push to your external registry
podman tag aap-mcp-server:latest <your-registry>/aap-mcp-server:latest
podman push <your-registry>/aap-mcp-server:latest

# Update deployment.yaml to reference your registry image
# Then apply: oc apply -f deployment.yaml
```

## Verify Deployment

```bash
# Check pod status
oc get pods -n aap-mcp-server

# Check pod logs
oc logs -f deployment/aap-mcp-server -n aap-mcp-server

# Check events for issues
oc get events -n aap-mcp-server --sort-by='.lastTimestamp'

# If pod fails due to permissions, check:
oc describe pod -n aap-mcp-server -l app=aap-mcp-server
```

