FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY fastapi/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . /app

WORKDIR /app/fastapi
RUN mkdir -p cache downloads

EXPOSE 8000

# Run one worker because job state and queues are in process memory.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]
