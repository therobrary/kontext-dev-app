import os
import sys
import threading
import time
import uuid
from collections import deque
from contextlib import suppress
from typing import Any
import argparse
import torch
from dotenv import load_dotenv
import logging
import torch
import io
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from loguru import logger
from PIL import Image, UnidentifiedImageError
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv

# Import the Celery app instance and the task
from tasks import celery_app, generate_image_task

# --- Dotenv Configuration ---
load_dotenv()

# --- Logging Configuration (Loguru) ---
logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
)

class InterceptHandler(logging.Handler):
    def emit(self, record):
        if "GET /status/" in record.getMessage() and record.levelno == logging.INFO:
            return
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        frame, depth = logging.currentframe(), 2
        while frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())
        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )

logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

# --- Application Configuration ---
class Config:
    MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", 10))
    MAX_CONTENT_LENGTH = MAX_UPLOAD_MB * 1024 * 1024
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
    RESULTS_FOLDER = os.getenv("RESULTS_FOLDER", "generated_images")
    # HF Token
    HF_TOKEN = os.getenv("HUGGING_FACE_HUB_TOKEN", None)
    # Default generation parameters
    CELERY_LOG_FILE = os.getenv("CELERY_LOG_FILE", "/app/celery_worker.log")
    DEFAULT_WIDTH = 1024
    DEFAULT_HEIGHT = 1024
    DEFAULT_STEPS = 28
    DEFAULT_GUIDANCE_SCALE = 2.5
    DEFAULT_TRUE_CFG_SCALE = 1.0


# --- Model Initialization ---
# This is a blocking, long-running operation, so it's done once at startup.
logger.info("Initializing model... This may take a few minutes.")
pipe = None
try:
    # Use environment variable for device, with auto-detection as fallback
    _default_device = "cuda" if torch.cuda.is_available() else "cpu"
    DEVICE = os.getenv("PYTORCH_DEVICE", _default_device)
    TORCH_DTYPE = (
        torch.bfloat16 if DEVICE == "cuda" else torch.float32
    )  # bfloat16 not supported on CPU for all ops

    if not torch.cuda.is_available():
        logger.warning(
            "CUDA not available. Running on CPU, which will be extremely slow."
        )

    from dfloat11 import DFloat11Model
    from diffusers import FluxKontextPipeline

    if Config.HF_TOKEN:
        pipe = FluxKontextPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-Kontext-dev",
            torch_dtype=TORCH_DTYPE,
            token=Config.HF_TOKEN,
        )
        DFloat11Model.from_pretrained(
            "DFloat11/FLUX.1-Kontext-dev-DF11",
            device="cpu",  # DFloat11 specific, may need CPU
            bfloat16_model=pipe.transformer,
            token=Config.HF_TOKEN,
        )
    else:
        pipe = FluxKontextPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-Kontext-dev",
            torch_dtype=TORCH_DTYPE,
        )
        DFloat11Model.from_pretrained(
            "DFloat11/FLUX.1-Kontext-dev-DF11",
            device="cpu",  # DFloat11 specific, may need CPU
            bfloat16_model=pipe.transformer,
        )

    if DEVICE == "cuda":
        # Offloading is essential for consumer GPUs with limited VRAM
        pipe.enable_model_cpu_offload()
    else:
        pipe.to(DEVICE)

    logger.info(f"Model initialized successfully on device '{DEVICE}'.")

    # --- Create results directory ---
    try:
        os.makedirs(Config.RESULTS_FOLDER, exist_ok=True)
        logger.info(f"Results will be saved in '{Config.RESULTS_FOLDER}' directory.")
    except OSError as e:
        logger.critical(f"Could not create results directory. Error: {e}")
        exit(1)

except ImportError as e:
    logger.critical(f"A required library is not installed. {e}")
    exit(1)
except Exception as e:
    # This could be a huggingface connection error, file not found, etc.
    logger.critical(f"Could not initialize the model. Error: {e}")
    # The app is not functional without the model, so we exit.
    exit(1)


# --- Asynchronous Task Queue Setup ---
# This simple in-memory queue is for a single-worker setup.
# For multi-worker production, use Celery/Redis.
job_queue: deque[str] = deque()
job_results: dict[str, dict[str, Any]] = {}
# A lock is crucial for safely modifying the queue and results from different threads.
queue_lock = threading.Lock()


# --- Flask App Setup ---
app = Flask(__name__)
app.config.from_object(Config)
CORS(app)  # Enable Cross-Origin Resource Sharing

# Configure ProxyFix to handle proxy headers correctly
# This tells Flask to trust proxy headers for HTTPS detection
app.wsgi_app = ProxyFix(  # type: ignore[method-assign]
    app.wsgi_app,
    x_for=1,  # Trust 1 proxy for X-Forwarded-For
    x_proto=1,  # Trust 1 proxy for X-Forwarded-Proto (http/https)
    x_host=1,  # Trust 1 proxy for X-Forwarded-Host
    x_prefix=1,  # Trust 1 proxy for X-Forwarded-Prefix
)

# The default Flask logger is now intercepted by Loguru, so no app-specific setup is needed.

CORS(app)

# Create results directory if it doesn't exist
try:
    os.makedirs(Config.RESULTS_FOLDER, exist_ok=True)
    logger.info(f"Results will be saved in '{Config.RESULTS_FOLDER}' directory.")
except OSError as e:
    logger.critical(f"Could not create results directory. Error: {e}")
    sys.exit(1)

# --- Helper Functions ---
def is_allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in Config.ALLOWED_EXTENSIONS
    return "." in filename and filename.rsplit(".", 1)[1].lower() in Config.ALLOWED_EXTENSIONS

def parse_request_args(form_data, image_file):
    if not image_file or not is_allowed_file(image_file.filename):
        raise ValueError(
            "Invalid or no image file provided. Allowed types: "
            + ", ".join(Config.ALLOWED_EXTENSIONS)
        )

    try:
        input_image = Image.open(image_file.stream).convert("RGB")
    except UnidentifiedImageError:
        raise ValueError("The uploaded file is not a valid image.")

    with io.BytesIO() as output:
        input_image.save(output, format="PNG")
        image_bytes = output.getvalue()

    with io.BytesIO() as output:
        input_image.save(output, format="PNG")
        image_bytes = output.getvalue()

    try:
        args = {
            "image_bytes": image_bytes,
            "image_info": {"size": input_image.size, "mode": input_image.mode},
            "image_bytes": image_bytes,
            "image_info": {"size": input_image.size, "mode": input_image.mode},
            "prompt": form_data.get("prompt", ""),
            "width": int(form_data.get("width", Config.DEFAULT_WIDTH)),
            "height": int(form_data.get("height", Config.DEFAULT_HEIGHT)),
            "num_inference_steps": int(
                form_data.get("num_inference_steps", Config.DEFAULT_STEPS)
            ),
            "guidance_scale": float(
                form_data.get("guidance_scale", Config.DEFAULT_GUIDANCE_SCALE)
            ),
            "true_cfg_scale": float(
                form_data.get("true_cfg_scale", Config.DEFAULT_TRUE_CFG_SCALE)
            ),
            "max_sequence_length": 512,
            "max_sequence_length": 512,
            "num_images_per_prompt": 1,
        }
    except (ValueError, TypeError) as e:
        raise ValueError(
            f"Invalid parameter type provided. Please ensure all numerical fields are numbers. Details: {e}"
        ) from e
        raise ValueError(f"Invalid parameter type provided. Details: {e}")

    for key in ["prompt_2", "negative_prompt", "negative_prompt_2"]:
        value = form_data.get(key)
        if value:
            args[key] = value

    seed_str = form_data.get("seed")
    if seed_str and seed_str.isdigit():
        seed = int(seed_str)
    else:
        seed = torch.randint(0, 2**32 - 1, (1,)).item()
    
    args["seed_value"] = seed
    
    args["seed_value"] = seed

    return args

# --- API Endpoints ---
@app.route("/config", methods=["GET"])
def get_config():
    return jsonify({"apiBaseUrl": ""})
    return jsonify({"apiBaseUrl": ""})

@app.route("/process-image", methods=["POST"])
def generate_image_endpoint():
    if "image" not in request.files:
        return jsonify({"error": "No 'image' file part in the request."}), 400

    try:
        pipe_kwargs = parse_request_args(request.form, request.files["image"])
    except ValueError as e:
        logger.warning(f"Bad request from {request.remote_addr}: {e}")
        return jsonify({"error": str(e)}), 400

    task = generate_image_task.delay(pipe_kwargs, Config.RESULTS_FOLDER)
    
    logger.info(f"Job {task.id} accepted and sent to Celery worker.")
    
    task = generate_image_task.delay(pipe_kwargs, Config.RESULTS_FOLDER)
    
    logger.info(f"Job {task.id} accepted and sent to Celery worker.")
    
    return jsonify(
        {
            "message": "Request accepted and queued for processing.",
            "job_id": task.id,
            "status_url": f"/status/{task.id}",
            "result_url": f"/result/{task.id}",
            "message": "Request accepted and queued for processing.",
            "job_id": task.id,
            "status_url": f"/status/{task.id}",
            "result_url": f"/result/{task.id}",
        }
    ), 202

@app.route("/status/<job_id>", methods=["GET"])
def get_status(job_id):
    """Provides the status of a specific Celery task."""
    task_result = celery_app.AsyncResult(job_id)
    response = {
        "job_id": job_id,
        "status": task_result.state,
    }
    if task_result.state == 'FAILURE':
        response['error'] = str(task_result.info)
    elif task_result.state == 'SUCCESS':
        response['result'] = task_result.result
    return jsonify(response)


@app.route("/result/<job_id>", methods=["GET"])
def get_result(job_id):
    task_result = celery_app.AsyncResult(job_id)
    if not task_result.ready():
        return jsonify({"error": f"Job not complete. Status: {task_result.state}"}), 202
    if task_result.successful():
        result_data = task_result.get()
        result_path = result_data.get("result_path")
    task_result = celery_app.AsyncResult(job_id)
    if not task_result.ready():
        return jsonify({"error": f"Job not complete. Status: {task_result.state}"}), 202
    if task_result.successful():
        result_data = task_result.get()
        result_path = result_data.get("result_path")
        if result_path and os.path.exists(result_path):
            return send_file(result_path, mimetype="image/png")
        else:
            return jsonify({"error": "Result file is missing."}), 500
            return jsonify({"error": "Result file is missing."}), 500
    else:
        return jsonify({"error": str(task_result.info)}), 500

# NEW: Endpoint to get the celery worker log
@app.route("/celery-log", methods=["GET"])
def get_celery_log():
    """Reads the last N lines of the Celery worker log file."""
    log_file_path = app.config["CELERY_LOG_FILE"]
    try:
        if os.path.exists(log_file_path):
            with open(log_file_path, 'r') as f:
                # Read all lines and return the last 50
                lines = f.readlines()
                log_content = "".join(lines[-50:])
                return jsonify({"log": log_content})
        else:
            return jsonify({"log": "Log file not found."})
    except Exception as e:
        logger.error(f"Could not read log file: {e}")
        return jsonify({"error": "Could not read log file."}), 500

@app.route("/")
def index():
    return send_file("static/index.html")
    return jsonify({"error": str(task_result.info)}), 500

# NEW: Endpoint to get the celery worker log
@app.route("/celery-log", methods=["GET"])
def get_celery_log():
    """Reads the last N lines of the Celery worker log file."""
    log_file_path = app.config["CELERY_LOG_FILE"]
    try:
        if os.path.exists(log_file_path):
            with open(log_file_path, 'r') as f:
                # Read all lines and return the last 50
                lines = f.readlines()
                log_content = "".join(lines[-50:])
                return jsonify({"log": log_content})
        else:
            return jsonify({"log": "Log file not found."})
    except Exception as e:
        logger.error(f"Could not read log file: {e}")
        return jsonify({"error": "Could not read log file."}), 500

@app.route("/")
def index():
    return send_file("static/index.html")

# --- Custom Error Handlers ---
# --- Custom Error Handlers ---
@app.errorhandler(404)
def not_found_error(error):
    return jsonify({"error": "Not Found"}), 404
    return jsonify({"error": "Not Found"}), 404

@app.errorhandler(405)
def method_not_allowed_error(error):
    return jsonify({"error": "Method Not Allowed"}), 405
    return jsonify({"error": "Method Not Allowed"}), 405

@app.errorhandler(413)
def payload_too_large_error(error):
    return jsonify({"error": "Payload Too Large"}), 413
    return jsonify({"error": "Payload Too Large"}), 413

@app.errorhandler(500)
def internal_server_error(error):
    logger.exception(f"Internal Server Error: {error}")
    return jsonify({"error": "Internal Server Error"}), 500

    return jsonify({"error": "Internal Server Error"}), 500

if __name__ == "__main__":
    # 1. Set up the argument parser
    parser = argparse.ArgumentParser(description="Run the Flask image generation server.")
    parser.add_argument(
        "--port",
        type=int,
        default=5000,
        help="The port to run the Flask application on (default: 5000)",
    )
    args = parser.parse_args()


    # Serve the static frontend


    logger.info(f"Starting Flask development server on port {args.port}.")
    logger.warning(
        "This is a development server. For production, use a WSGI server like Gunicorn."
    )
    # 2. Use the parsed port argument in app.run()
    app.run(
        host="0.0.0.0", port=args.port, debug=False
    )  # Debug mode should be False for this setup

    # When running with `flask run` or a WSGI server like Gunicorn,
    # this block is not executed. Gunicorn will directly interact with the `app` object.
    logger.info("Starting Flask development server.")
    logger.warning("This is a development server. For production, use Gunicorn and Celery workers.")
    app.run(host="0.0.0.0", port=5000, debug=False)