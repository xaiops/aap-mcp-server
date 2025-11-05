#!/bin/bash
# Script to update AAP MCP Server deployment on OpenShift
# This script builds a new image and updates the deployment

set -e

# Configuration
NAMESPACE="aap-mcp-server"
IMAGE_NAME="quay.io/chrhamme/aap-mcp-server"
IMAGE_TAG="${1:-latest}"

echo "🚀 Updating AAP MCP Server deployment on OpenShift"
echo "=================================================="
echo "Namespace: ${NAMESPACE}"
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""

# Check if we're logged into OpenShift
if ! oc whoami &> /dev/null; then
    echo "❌ Error: Not logged into OpenShift. Please run 'oc login' first."
    exit 1
fi

# Check if namespace exists
if ! oc get namespace ${NAMESPACE} &> /dev/null; then
    echo "📦 Creating namespace ${NAMESPACE}..."
    oc create namespace ${NAMESPACE}
fi

# Switch to namespace
oc project ${NAMESPACE}

# Build the image
echo "🔨 Building container image..."
podman build -f Containerfile -t ${IMAGE_NAME}:${IMAGE_TAG} .

# Push the image
echo "📤 Pushing image to registry..."
podman push ${IMAGE_NAME}:${IMAGE_TAG}

# Update deployment with new image
echo "🔄 Updating deployment with new image..."
oc set image deployment/aap-mcp-server aap-mcp-server=${IMAGE_NAME}:${IMAGE_TAG} -n ${NAMESPACE}

# Wait for rollout
echo "⏳ Waiting for rollout to complete..."
oc rollout status deployment/aap-mcp-server -n ${NAMESPACE} --timeout=5m

# Show deployment status
echo ""
echo "✅ Deployment update complete!"
echo ""
echo "📊 Deployment status:"
oc get deployment aap-mcp-server -n ${NAMESPACE}
echo ""
echo "📋 Pod status:"
oc get pods -l app=aap-mcp-server -n ${NAMESPACE}
echo ""
echo "📝 Recent logs:"
oc logs -l app=aap-mcp-server -n ${NAMESPACE} --tail=20

