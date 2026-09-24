# Management Tool API — backend image (API + arq worker share this image)
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# curl for compose healthchecks; nothing else required at runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

# uploads volume mount point; app runs unprivileged — the mount target must
# exist and be owned by appuser BEFORE the named volume attaches, otherwise
# Docker creates it root-owned and writes fail.
RUN useradd --system --uid 10001 --home /app appuser \
    && mkdir -p /app/uploads /data/uploads \
    && chown -R appuser:appuser /app/uploads /data/uploads
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os,sys,urllib.request; sys.exit(0) if os.environ.get('PROCESS_ROLE') == 'worker' else urllib.request.urlopen('http://localhost:8000/health', timeout=4)"]

# --proxy-headers: trust X-Forwarded-* from nginx so request.base_url and
# client IPs reflect the real client.
CMD ["bash", "start.sh"]
