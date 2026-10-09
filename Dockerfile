FROM python:3.10-slim

# System dependencies for CPU inference
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    curl \
    libopenblas-dev \
    libomp-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for caching
COPY backend/requirements.txt ./requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Install llama.cpp for GGUF quantization
RUN git clone --depth 1 https://github.com/ggerganov/llama.cpp /llama.cpp && \
    cd /llama.cpp && \
    make -j$(nproc) && \
    cp /llama.cpp/llama-quantize /usr/local/bin/ && \
    cp /llama.cpp/llama-convert /usr/local/bin/ && \
    rm -rf /llama.cpp

# Copy application code
COPY backend ./backend
COPY frontend ./frontend
COPY models ./models
COPY scripts ./scripts

# Create non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose ports
EXPOSE 7860 7861

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:7860/health || exit 1

# Start server
CMD ["python", "backend/main.py"]
