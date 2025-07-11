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

# Add labels for better registry metadata
LABEL org.opencontainers.image.title="Kontext Dev App"
LABEL org.opencontainers.image.description="AI Photo Stylizer using FLUX.1-Kontext-dev model with DFloat11 quantization"
LABEL org.opencontainers.image.source="https://github.com/therobrary/kontext-dev-app"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.vendor="therobrary"

# Environment configuration
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Etc/UTC \
    HF_HOME=/app/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies and create non-root user
RUN echo "Cache Buster Value: ${CACHE_BUSTER}" && \
    apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    redis-server \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r appuser && useradd -r -g appuser appuser \
    && mkdir -p /app/generated_images /app/huggingface /var/lib/redis /var/log/redis \
    && chown -R appuser:appuser /app /var/lib/redis /var/log/redis \
    && chown appuser:appuser /etc/redis/redis.conf || true

# Copy application files
COPY . .

# Install Python dependencies
# Note: In environments with SSL issues, you may need to add --trusted-host flags:
# pip install --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org -r requirements.txt
# Configure git to work with potential SSL issues and install dependencies
RUN git config --global http.sslVerify false && \
    pip install --no-cache-dir --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org -r requirements.txt || \
    (echo "Network installation failed, trying alternative approach..." && \
     pip install --no-cache-dir --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org \
     celery redis "dfloat11[cuda12]>=0.2.0" "flask>=3.1.1" "flask-cors>=6.0.1" "loguru>=0.7.3" \
     "protobuf>=6.31.1" "python-dotenv>=1.1.1" "sentencepiece>=0.2.0" "gunicorn>=23.0.0" && \
     echo "WARNING: Using standard diffusers instead of development version. FluxKontextPipeline may not be available." && \
     pip install --no-cache-dir diffusers)

# Make start script executable and switch to non-root user
RUN chmod +x start.sh \
    && chown appuser:appuser start.sh

# Switch to non-root user
USER appuser

# Expose ports for Flask app and Redis
EXPOSE 5000 6379

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/config || exit 1

# Start the application
ENTRYPOINT ["./start.sh"]