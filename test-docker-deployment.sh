#!/bin/bash
# Test script to verify Docker deployment functionality
set -e

echo "🧪 Testing Docker deployment for Kontext Dev App"
echo "================================================"

# Test 1: Build from source
echo "📦 Test 1: Building image from source..."
docker build -t kontext-dev-app:test-local . > /dev/null 2>&1
echo "✅ Build successful"

# Test 2: Run container and verify it starts
echo "🚀 Test 2: Testing container startup..."

# Clean up any existing container
docker stop test-container 2>/dev/null || true
docker rm test-container 2>/dev/null || true

docker run --rm -d --name test-container \
  -p 5000:5000 \
  -e HUGGING_FACE_HUB_TOKEN="" \
  -e PYTORCH_DEVICE=cpu \
  kontext-dev-app:test-local

echo "⏳ Waiting for container to start..."
sleep 15

# Test 3: Verify health endpoint
echo "🔍 Test 3: Testing health endpoint..."
if curl -f -s http://localhost:5000/config | grep -q "apiBaseUrl"; then
  echo "✅ Health endpoint working"
else
  echo "❌ Health endpoint failed"
  docker logs test-container
  docker stop test-container
  exit 1
fi

# Test 4: Test docker-compose configuration
echo "📋 Test 4: Validating docker-compose configurations..."
docker compose config > /dev/null 2>&1
echo "✅ docker-compose.yml is valid"

# Tag the image to simulate registry image for production compose test
docker tag kontext-dev-app:test-local ghcr.io/therobrary/kontext-dev-app:latest
docker compose -f docker-compose.prod.yml config > /dev/null 2>&1
echo "✅ docker-compose.prod.yml is valid"

# Cleanup
echo "🧹 Cleaning up..."
docker stop test-container > /dev/null 2>&1
docker rmi kontext-dev-app:test-local > /dev/null 2>&1
docker rmi ghcr.io/therobrary/kontext-dev-app:latest > /dev/null 2>&1

echo ""
echo "🎉 All tests passed! Docker deployment is ready."
echo ""
echo "To deploy using pre-built images (when available):"
echo "  docker-compose -f docker-compose.prod.yml up"
echo ""
echo "To build and deploy from source:"
echo "  docker-compose up --build"