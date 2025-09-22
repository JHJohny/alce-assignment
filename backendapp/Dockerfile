FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN adduser --system --group app
WORKDIR /app

COPY requirements.txt .

RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --upgrade pip && \
    pip install --no-cache-dir --no-compile --only-binary=:all: -r requirements.txt || \
    pip install --no-cache-dir --no-compile -r requirements.txt && \
    find /usr/local -type d -name "__pycache__" -prune -exec rm -rf {} +; \
    find /usr/local -type f \( -name "*.pyc" -o -name "*.pyo" \) -delete

COPY backend.py .

USER app
EXPOSE 8080
CMD ["uvicorn","backend:app","--host","0.0.0.0","--port","8080"]
