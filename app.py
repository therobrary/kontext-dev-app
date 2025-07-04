import os
import sys
import logging
import torch
import io
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from loguru import logger
from PIL import Image, UnidentifiedImageError
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
    DEFAULT_WIDTH = 1024
    DEFAULT_HEIGHT = 1024
    DEFAULT_STEPS = 28
    DEFAULT_GUIDANCE_SCALE = 2.5
    DEFAULT_TRUE_CFG_SCALE = 1.5

# --- Flask App Setup ---
app = Flask(__name__)
app.config.from_object(Config)
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

    # Convert the image to bytes to pass to Celery.
    # This is more robust than passing a complex object.
    with io.BytesIO() as output:
        input_image.save(output, format="PNG")
        image_bytes = output.getvalue()

    try:
        args = {
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
            "num_images_per_prompt": 1,
        }
    except (ValueError, TypeError) as e:
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

    return args

# --- API Endpoints ---
@app.route("/config", methods=["GET"])
def get_config():
    """Provides frontend configuration."""
    return jsonify({"apiBaseUrl": ""}) # Base URL is relative on the same host

@app.route("/process-image", methods=["POST"])
def generate_image_endpoint():
    """
    Accepts image generation requests, sends them to the Celery worker,
    and returns a job ID for status polling.
    """
    if "image" not in request.files:
        return jsonify({"error": "No 'image' file part in the request."}), 400

    try:
        pipe_kwargs = parse_request_args(request.form, request.files["image"])
    except ValueError as e:
        logger.warning(f"Bad request from {request.remote_addr}: {e}")
        return jsonify({"error": str(e)}), 400

    task = generate_image_task.delay(pipe_kwargs, Config.RESULTS_FOLDER)
    
    logger.info(f"Job {task.id} accepted and sent to Celery worker.")
    
    return jsonify(
        {
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
    """Serves the generated image if the task is complete."""
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
    else:
        return jsonify({"error": str(task_result.info)}), 500

@app.route("/")
def index():
    return send_file("static/index.html")

# --- Custom Error Handlers ---
@app.errorhandler(404)
def not_found_error(error):
    return jsonify({"error": "Not Found"}), 404

@app.errorhandler(405)
def method_not_allowed_error(error):
    return jsonify({"error": "Method Not Allowed"}), 405

@app.errorhandler(413)
def payload_too_large_error(error):
    return jsonify({"error": "Payload Too Large"}), 413

@app.errorhandler(500)
def internal_server_error(error):
    logger.exception(f"Internal Server Error: {error}")
    return jsonify({"error": "Internal Server Error"}), 500

if __name__ == "__main__":
    logger.info("Starting Flask development server.")
    logger.warning("This is a development server. For production, use Gunicorn and Celery workers.")
    app.run(host="0.0.0.0", port=5000, debug=False)
