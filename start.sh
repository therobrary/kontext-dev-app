#!/bin/bash
# Exit immediately if a command exits with a non-zero status.
set -e

# --- Dynamic .env File Creation ---
# This section creates the .env file from environment variables passed to the container.
echo "Generating .env file from environment variables..."
cat << EOF > .env
# This file is auto-generated at container startup by start.sh

# --- Application Configuration ---
MAX_UPLOAD_MB=${MAX_UPLOAD_MB:-10}
RESULTS_FOLDER=${RESULTS_FOLDER:-generated_images}
MAX_QUEUE_SIZE=${MAX_QUEUE_SIZE:-10}
JOB_RESULT_TTL=${JOB_RESULT_TTL:-600}
CLEANUP_INTERVAL=${CLEANUP_INTERVAL:-300}

# --- Celery Configuration ---
# The URL for the Redis message broker.
REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379/0}

# --- Model & Hardware Settings ---
# Hugging Face Hub access token for downloading gated models
HUGGING_FACE_HUB_TOKEN=${HUGGING_FACE_HUB_TOKEN:-}
# PyTorch device (cuda or cpu)
PYTORCH_DEVICE=${PYTORCH_DEVICE:-cuda}
EOF
echo ".env file created successfully."

# --- Start Background Services ---
echo "Starting Redis server in the background..."
# Start Redis with appropriate permissions for the appuser
redis-server --daemonize yes --bind 127.0.0.1 --port 6379
echo "Redis server started."

echo "Starting Celery worker in the background..."
# The '&' at the end runs this command as a background process.
# We direct output to a log file for easier debugging.
# Running as the current user (appuser) instead of root for security
celery -A tasks.celery_app worker --loglevel=info --concurrency=1 > /app/celery_worker.log 2>&1 &
echo "Celery worker started. Logs are in /app/celery_worker.log"

# --- Start the Main Application with Gunicorn (Foreground Process) ---
# This is the final command and will run in the foreground.
# Gunicorn will now only handle fast API requests, so a long timeout isn't strictly necessary,
# but we keep it to prevent any issues with slow client connections.
echo "Starting Flask application with Gunicorn..."
exec gunicorn --workers 1 --threads 8 --timeout 600 -b 0.0.0.0:5000 app:app