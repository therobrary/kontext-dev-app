# Docker Deployment Guide

This repository includes Docker support for easy deployment to any Docker host.

## Prerequisites

- Docker installed with nvidia-container-toolkit for GPU support
- NVIDIA GPU with ~21GB VRAM (required for DFloat11 quantization)
- Hugging Face account and token (for downloading gated models)

## Quick Start with Docker

### Option 1: Using docker-compose (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/therobrary/kontext-dev-app.git
   cd kontext-dev-app
   ```

2. **Set your Hugging Face token:**
   ```bash
   export HUGGING_FACE_HUB_TOKEN=your_token_here
   ```

3. **Start the application:**
   ```bash
   docker-compose up --build
   ```

   The application will be available at http://localhost:5000

### Option 2: Using Docker directly

1. **Build the image:**
   ```bash
   docker build -t kontext-dev-app .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     --name kontext-dev-app \
     --gpus all \
     -p 5000:5000 \
     -v ./generated_images:/app/generated_images \
     -v ./huggingface_cache:/app/huggingface \
     -e HUGGING_FACE_HUB_TOKEN=your_token_here \
     -e MAX_UPLOAD_MB=10 \
     -e PYTORCH_DEVICE=cuda \
     kontext-dev-app
   ```

## Configuration

The application can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `HUGGING_FACE_HUB_TOKEN` | Required for downloading gated models | - |
| `MAX_UPLOAD_MB` | Maximum upload size in MB | 10 |
| `RESULTS_FOLDER` | Directory for generated images | generated_images |
| `MAX_QUEUE_SIZE` | Maximum jobs in queue | 10 |
| `JOB_RESULT_TTL` | Job result retention time (seconds) | 600 |
| `PYTORCH_DEVICE` | Device for inference (cuda/cpu) | cuda |

## Volumes

- `/app/generated_images` - Persist generated images
- `/app/huggingface` - Cache downloaded models

## GPU Support

The container requires GPU support. Make sure you have:

1. **nvidia-container-toolkit installed:**
   ```bash
   # Ubuntu/Debian
   sudo apt install nvidia-container-toolkit
   sudo systemctl restart docker
   ```

2. **Test GPU access:**
   ```bash
   docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu22.04 nvidia-smi
   ```

## Troubleshooting

- **Out of memory errors**: Reduce batch size or use a GPU with more VRAM
- **Model download issues**: Verify your HUGGING_FACE_HUB_TOKEN is valid
- **Permission errors**: Ensure Docker has write access to volume mount paths
- **SSL certificate errors during build**: Add pip trusted hosts if building in restricted networks

## Architecture

The Docker container includes:
- Flask web server (Gunicorn)
- Celery background worker for image processing
- Redis for task queue
- All services run in a single container for simplicity

For production deployments, consider splitting services across multiple containers.