import os
import time
import torch
from celery import Celery
from loguru import logger
from PIL import Image
from dotenv import load_dotenv
from threading import Lock

# --- Dotenv Configuration ---
load_dotenv()

# --- Celery Configuration ---
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery(
    "tasks",
    broker=REDIS_URL,
    backend=REDIS_URL
)

# --- Model Initialization ---
# The model is a global variable for the worker process.
# We initialize it to None and will load it on the first task run.
pipe = None
model_lock = Lock() # A lock to ensure the model is only initialized once

def initialize_model():
    """
    Initializes the diffusion model. This function is now only called from within the task.
    """
    global pipe
    logger.info("Initializing model for Celery worker... This may take a few minutes.")
    try:
        # Use environment variable for device, with auto-detection as fallback
        _default_device = "cuda" if torch.cuda.is_available() else "cpu"
        DEVICE = os.getenv("PYTORCH_DEVICE", _default_device)
        TORCH_DTYPE = (
            torch.bfloat16 if DEVICE == "cuda" else torch.float32
        )

        if not torch.cuda.is_available():
            logger.warning(
                "CUDA not available. Running on CPU, which will be extremely slow."
            )

        from dfloat11 import DFloat11Model
        from diffusers import FluxKontextPipeline

        hf_token = os.getenv("HUGGING_FACE_HUB_TOKEN")
        
        pipe = FluxKontextPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-Kontext-dev", 
            torch_dtype=TORCH_DTYPE, 
            use_auth_token=hf_token
        )
        DFloat11Model.from_pretrained(
            "DFloat11/FLUX.1-Kontext-dev-DF11",
            device="cpu",
            bfloat16_model=pipe.transformer,
            use_auth_token=hf_token
        )

        if DEVICE == "cuda":
            pipe.enable_model_cpu_offload()
        else:
            pipe.to(DEVICE)

        logger.info(f"Model initialized successfully on device '{DEVICE}'.")

    except ImportError as e:
        logger.critical(f"A required library is not installed. {e}")
        raise
    except Exception as e:
        logger.critical(f"Could not initialize the model for the Celery worker. Error: {e}")
        raise

# --- Celery Task Definition ---
@celery_app.task(bind=True)
def generate_image_task(self, pipe_kwargs, result_folder):
    """
    Celery task to generate an image using the diffusion pipeline.
    The model is loaded on the first run.
    """
    global pipe
    # Use a lock to ensure that if multiple tasks start at once (with concurrency > 1),
    # only one will actually initialize the model.
    with model_lock:
        if pipe is None:
            initialize_model()

    job_id = self.request.id
    log_params = {
        k: v for k, v in pipe_kwargs.items() if k not in ["image", "generator"]
    }
    log_params["seed"] = pipe_kwargs["seed_value"]
    logger.info(f"Processing job {job_id} with params: {log_params}")
    
    device = os.getenv("PYTORCH_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
    pipe_kwargs["generator"] = torch.Generator(device=device).manual_seed(pipe_kwargs["seed_value"])
    pipe_kwargs.pop("seed_value")

    try:
        processed_image = pipe(**pipe_kwargs).images[0]
        os.makedirs(result_folder, exist_ok=True)
        result_filename = f"{job_id}.png"
        result_path = os.path.join(result_folder, result_filename)
        processed_image.save(result_path, "PNG")

        logger.info(f"Job {job_id} completed successfully.")
        return {"status": "completed", "result_path": result_path}

    except torch.cuda.OutOfMemoryError as e:
        error_message = "Processing failed due to insufficient GPU memory. Try a smaller image size."
        logger.error(f"Job {job_id} failed: {error_message} - {e}")
        raise Exception(error_message) from e
    except Exception as e:
        logger.exception(f"An unexpected error occurred in worker for job {job_id}: {e}")
        raise
