# Private AI Photo Stylizer

**Welcome to 4o-ghibli-at-home! Your own private, high-performance AI photo stylizer, powered by the `FLUX.1-Kontext-dev` model.**

## Quick Start

### Requirements

- **Python 3.11+**
  - `pip` or `uv` (Python package installer; `uv` is recommended for speed)
- **NVIDIA GPU** (recommended for speed; CPU fallback supported)
  - ~21GB VRAM(preffered) or RAM, and a modern CPU
- Modern web browser (Chrome, Firefox, Edge, etc.)
- Some images to Ghiblify!

## Setup & Installation

### 1. Clone the Project

```bash
git clone https://github.com/TheAhmadOsman/4o-ghibli-at-home.git
cd 4o-at-home
```

### 2. Create and Activate a Python Virtual Environment

A virtual environment is crucial for isolating project dependencies. You can create one with Python's built-in `venv` module or with `uv`.

#### Option A: Using `uv` (Recommended)

If you have `uv` installed (see next step), you can create a virtual environment with it:

```bash
uv venv
```

#### Option B: Using standard `venv`

```bash
python3.12 -m venv venv
```

After creating the environment, activate it:

```bash
# Activate (Windows)
.venv\Scripts\activate
# Activate (macOS/Linux)
source .venv/bin/activate
```

*(Note: If you used a different name than `.venv` or `venv`, adjust the path accordingly.)*

### 3. Install Dependencies

Install the Python dependencies from `requirements.txt`. You can use either `uv` or `pip`.

**`uv` is a modern, extremely fast Python package manager that can be used as a drop-in replacement for `pip` and is highly recommended.**

#### Option A: Using `uv` (Recommended for Speed)

`uv` is an extremely fast Python package and virtual environment manager. Follow the official instructions to install it system-wide. This is a **one-time setup**.

**1. Install `uv`**

Open a new terminal and run the appropriate command for your operating system:

- **macOS / Linux:**

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

- **Windows:**

    ```powershell
    powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
    ```

> **Note:** After installation, you may need to restart your terminal or shell for the `uv` command to be available in your `PATH`.

**2. Install Project Dependencies**

Once `uv` is installed, use it to install the project's requirements into your **activated virtual environment**:

```bash
uv pip install -r requirements.txt
```

#### Option B: Using `pip`

If you prefer to use `pip` directly, ensure it's up-to-date and then install the dependencies:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

## How to Run

> **It's much simpler now! You only need ONE terminal.**

### 1. Start the Flask App

The application now runs with a single command. The background worker for processing images is started automatically.

- **For Development:**

  ```bash
  python app.py
  ```

- **For Production (Recommended):**

  Use a production-grade WSGI server like Gunicorn. **It is critical to use only ONE worker** because the job queue is in-memory and cannot be shared across multiple processes.

  - **Using Gunicorn:**

    ```bash
    # The `--workers 1` flag is essential for this application design.
    # Increase --threads for more concurrent I/O, and --timeout for long-running jobs.
    gunicorn --workers 1 --threads 4 --timeout 600 -b 0.0.0.0:5000 app:app
    ```

  - **Using uvicorn (fast ASGI/WSGI server):**

    ```bash
    uvicorn app:app --host 0.0.0.0 --port 5000
    ```

### 2. Open the Frontend

Once the server is running, open your web browser and navigate to:

**<http://127.0.0.1:5000>**

You can now upload an image and start stylizing!

## API Endpoints

- `POST /process-image` — Submits an image processing job. Returns a `job_id`.
- `GET /status/<job_id>` — Checks the status of a job (`queued`, `processing`, `completed`, `failed`).
- `GET /result/<job_id>` — If the job is `completed`, returns the generated PNG image.

## Major Features

- **Simplified Architecture**: No external dependencies like Redis or Celery. Just Python and the required ML libraries.
- **Asynchronous Task Queue**: Uses a simple, thread-safe, in-memory queue to handle image generation jobs one by one, preventing server overload.
- **GPU/CPU Agnostic**: Automatically uses an available NVIDIA GPU for high-speed processing and gracefully falls back to CPU if a GPU is not found.
- **Robust Error Handling**: Provides clear JSON error messages for invalid inputs, server-side errors (like out-of-memory), and full queues.
- **Secure by Default**: Includes checks for file size, type, and dimensions to prevent abuse.
- **Production-Ready**: Comes with instructions for running with production-grade servers like Gunicorn.
- **CPU Fallback**: If no GPU is available, tasks run on the CPU automatically.

## Project Structure

- `app.py` — The all-in-one Flask server, API endpoints, and background image processing worker.
- `static/index.html` — A simple frontend to interact with the API.
- `requirements.txt` — All Python dependencies (install with `uv` or `pip`).

## Deployment / Production Checklist

- [ ] Update `CORS(app)` in `app.py` to a specific origin for your frontend domain.
- [ ] In `app.py`, tune `Config` values like `MAX_QUEUE_SIZE` and `MAX_UPLOAD_MB` for your needs.
- [ ] **Crucially, run with a single worker process (e.g., `gunicorn --workers 1`)** due to the in-memory queue design.
- [ ] Use a reverse proxy like Nginx or Apache in front of the application for SSL/TLS, caching, and rate limiting.
- [ ] Set up log rotation for the output from your WSGI server.
- [ ] Set up monitoring to watch server health and resource usage.
- [ ] (Optional) Add an authentication layer (e.g., JWT/OAuth2) for private deployments.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

- **Non-Commercial Use Only:**
  Commercial use of this software is **not permitted** without an explicit, written license from the author.

You are free to use, modify, and distribute this software for personal, research, or non-commercial purposes under the terms of the AGPLv3.

If you make changes and deploy the software for public use (including as a service), you must make the complete source code of your modified version available under the same license.

For more details, see the [LICENSE](./LICENSE) file or visit:
[https://www.gnu.org/licenses/agpl-3.0.html](https://www.gnu.org/licenses/agpl-3.0.html)

## Support

Open issues on GitHub or contact the maintainer for bugs, help, or feature requests.

**Enjoy editing your photos with cutting-edge AI!**
