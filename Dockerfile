FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY fastapi/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . /app

WORKDIR /app/fastapi
RUN mkdir -p cache downloads

# Download the pinned GEHistoricalImagery Linux x64 binary if not already present
RUN if [ ! -f bin/GEHistoricalImagery ]; then \
        mkdir -p bin && \
        curl -fL https://github.com/Mbucari/GEHistoricalImagery/releases/download/v0.7.1/GEHistoricalImagery.0.7.1-linux-x64.tar.gz \
            -o /tmp/geh.tar.gz && \
        tar -xzf /tmp/geh.tar.gz -C bin && \
        chmod +x bin/GEHistoricalImagery && \
        rm /tmp/geh.tar.gz; \
    fi

EXPOSE 8000

# Run one worker because job state and queues are in process memory.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]
