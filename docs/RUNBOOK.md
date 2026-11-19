# ReelCast Operations Runbook

This runbook covers operational procedures, observability, Dead Letter Queue (DLQ) triage, stuck job troubleshooting, and capacity management for ReelCast.

---

## 1. System Health & Observability

### 1.1 Health Endpoints

- **Multi-Service Health Check (`GET /health`)**:
  - Checks connectivity to PostgreSQL (`prisma.$queryRaw`), RabbitMQ broker (`rabbitService.isConnected()`), and MinIO/S3 (`s3Storage.checkHealth()`).
  - Returns `200 OK` with JSON breakdown if all services are reachable:
    ```json
    { "status": "ok", "services": { "database": "up", "rabbitmq": "up", "storage": "up" }, "timestamp": "..." }
    ```
  - Returns `503 Service Unavailable` with details if any subsystem is degraded.

- **Admin Queue & DLQ Monitor (`GET /api/v1/admin/queues`)**:
  - Reports consumer count and message count for all active queues and DLQs (`ingest`, `transcribe`, `segment`, `analyze`, `render`, `cleanup`).
  - Contains `dlqAlert: true` whenever `totalDeadLetters > 0`.
  - Can be monitored by Prometheus / Datadog / uptime pingers.

### 1.2 Structured JSON Logging

Worker consumers emit structured JSON logs to standard output:
- **Events**: `job_started`, `job_completed`, `job_cancelled`, `job_failed`.
- **Fields**: `timestamp`, `event`, `jobId`, `videoId`, `stage`, `workerId`, `attempt`, `maxAttempts`, `error`, `errorCode`, `retryable`.
- Filter logs in Grafana/CloudWatch: `{event="job_failed", retryable=false}`.

---

## 2. RabbitMQ & DLQ Management

### 2.1 Topology Overview

- **Primary Exchange**: `reels.work` (direct)
  - Queues: `ingest`, `transcribe`, `segment`, `analyze`, `render`, `cleanup`.
- **Dead Letter Exchange (DLX)**: `reels.dlx` (direct)
  - Queues: `ingest.dlq`, `transcribe.dlq`, `segment.dlq`, `analyze.dlq`, `render.dlq`, `cleanup.dlq`.
- When a job exceeds its maximum retry attempts (default 3) or encounters a non-retryable error, it is nack'd without requeue and routed to its respective `.dlq`.

### 2.2 Inspecting Dead Letters

1. Call the admin queues endpoint:
   ```bash
   curl http://localhost:3001/api/v1/admin/queues
   ```
2. Or open the RabbitMQ Management UI:
   - URL: `http://localhost:15672` (Credentials: `guest` / `guest`)
   - Navigate to the **Queues** tab and locate queues ending in `.dlq`.
   - Click the queue and use **Get messages** to examine payload, headers, and failure reason (`x-death`).

### 2.3 Replaying DLQ Messages

Once the root cause (e.g., downstream microservice outage, bad configuration) is resolved:

#### Method A: RabbitMQ Shovel via Management UI
1. In RabbitMQ UI, go to **Admin** → **Shovel Management**.
2. Create a one-off shovel:
   - Source: Queue `<stage>.dlq`
   - Destination: Queue `<stage>`
   - Ack mode: `on-confirm`
   - Delete after: `queue-length`
3. Click **Add shovel**. The messages will immediately move back to the active queue.

#### Method B: RabbitMQ Shovel via CLI
```bash
docker exec -it podcast-reels-rabbitmq rabbitmqctl shovel \
  --source-uri "amqp://" \
  --source-queue "transcribe.dlq" \
  --destination-uri "amqp://" \
  --destination-queue "transcribe" \
  --ack-mode "on-confirm"
```

### 2.4 Purging Queues

If dead letters are invalid or discarded:
- In RabbitMQ UI: Select queue → Scroll down to **Purge** → Click **Purge Messages**.
- Via Docker CLI:
  ```bash
  docker exec -it podcast-reels-rabbitmq rabbitmqctl purge_queue ingest.dlq
  ```

---

## 3. Investigating Stuck & Orphaned Jobs

### 3.1 Automated Job Reaper & Maintenance

ReelCast runs an automated maintenance service (`MaintenanceService` & `JobReaperService`) periodically:
- Uses PostgreSQL advisory lock (`7823468`) to ensure only one instance executes across horizontal replicas.
- Automatically finds orphaned jobs where `status = RUNNING` and `updatedAt` is older than the configured timeout (default 15 minutes).
- If attempts remain, resets the job to `QUEUED` and re-publishes the event.
- If max attempts were reached, marks the job as `FAILED`.

### 3.2 Manual Job Querying

Connect to PostgreSQL:
```bash
docker exec -it podcast-reels-postgres psql -U podcast -d podcast_reels
```

Find stuck running jobs:
```sql
SELECT id, "videoId", stage, status, attempt, "maxAttempts", "updatedAt"
FROM "ProcessingJob"
WHERE status = 'RUNNING' AND "updatedAt" < NOW() - INTERVAL '15 minutes';
```

Manually reset a stuck job back to `QUEUED`:
```sql
UPDATE "ProcessingJob"
SET status = 'QUEUED', "updatedAt" = NOW()
WHERE id = '<job_id>';
```

---

## 4. Storage Quotas & Asset Retention

### 4.1 Resource Limits

- **Concurrent Processing**: Maximum 3 active videos in `UPLOADING` or `PROCESSING` per user.
- **Concurrent Renders**: Maximum 2 active renders in `QUEUED` or `RUNNING` per user.
- **Storage Quota**: 10 GB per user across all active `MediaAsset` entries.

### 4.2 Expired Assets & Cleanup Worker

- Renders have an expiration TTL (`RENDER_RETENTION_DAYS`, default 14 days).
- When a video is soft-deleted (`deletedAt` set), the `CLEANUP` worker purges all corresponding S3 objects and sets `MediaAsset.status = 'PURGED'`.
- To monitor disk usage per user in PostgreSQL:
  ```sql
  SELECT "userId", pg_size_pretty(SUM("sizeBytes")::bigint) AS total_used
  FROM "MediaAsset"
  WHERE status != 'PURGED'
  GROUP BY "userId"
  ORDER BY SUM("sizeBytes") DESC;
  ```

---

## 5. Worker Recovery & Graceful Shutdown

1. **Signal Handling**:
   - Background worker processes (`worker.ts`) trap `SIGTERM` and `SIGINT`.
   - On receipt, the worker cancels its consumer channels, finishes inflight jobs within the grace window, or negatively acknowledges (nack) incomplete tasks with `requeue = true`.
2. **Worker Restart**:
   ```bash
   # Restart local background worker
   npm run dev:worker

   # Or in Docker
   docker compose restart worker
   ```
