#!/bin/sh
# PROCESS_ROLE=worker runs the arq worker (owns cron + job queue);
# anything else runs the API web server.
if [ "$PROCESS_ROLE" = "worker" ]; then
    exec arq app.workers.settings.WorkerSettings
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers
