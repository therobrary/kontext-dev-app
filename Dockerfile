# Kontext Dev App Dockerfile
# 
# This Dockerfile provides an easy way to deploy the Kontext Dev App to any Docker host.
# The app is an AI photo stylizer using FLUX.1-Kontext-dev model with DFloat11 quantization.
#
# Requirements:
# - NVIDIA GPU with ~21GB VRAM (for DFloat11 quantization)
# - Docker with nvidia-container-toolkit for GPU support
# 
# Build: docker build -t kontext-dev-app .
# Run:   docker run -p 5000:5000 --gpus all kontext-dev-app

FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

# Build argument for cache busting
ARG CACHE_BUSTER=none

# Environment configuration
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Etc/UTC \
    HF_HOME=/app/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN echo "Cache Buster Value: ${CACHE_BUSTER}" && \
    apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    redis-server \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY . .

# Install Python dependencies
# Note: In environments with SSL issues, you may need to add --trusted-host flags:
# pip install --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org -r requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Make start script executable
RUN chmod +x start.sh

# Expose ports for Flask app and Redis
EXPOSE 5000 6379

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/config || exit 1

# Start the application
ENTRYPOINT ["./start.sh"]