FROM python:3.10-slim

# Install build deps required by some packages (faiss, sentence-transformers, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential \
       git \
       ca-certificates \
       gcc \
       libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only requirements first to leverage layer caching
COPY requirements-rag-service.txt ./
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r requirements-rag-service.txt gunicorn

# Copy the rest of the repo
COPY . /app

# Expose port (Render will provide $PORT at runtime)
EXPOSE 8000

# Use shell form so $PORT will be expanded at runtime by the shell
CMD gunicorn -k uvicorn.workers.UvicornWorker rag_service:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120
