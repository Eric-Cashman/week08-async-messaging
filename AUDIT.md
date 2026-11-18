# AI Output Audit: Order Fulfillment (REST + RabbitMQ)

- **Tool:** Claude (AI draft generated from the prompt in `PROMPTS.md`)
- **Draft location:** `ai-draft/` (committed untouched as "Raw AI draft")
- **Method:** (1) read the code against the checklist, (2) run it, (3) break it on purpose
- Line numbers refer to the files in `ai-draft/src/`.
- **Read** = confirmed by reading the code. **Ran** = confirmed by running the system. Only claim "Ran" findings in the video.

## 1. Assignment checklist (the four required items)

| # | Check | Verdict | Where in the code (Read) | Confirmed by running (Ran) |
|---|-------|---------|--------------------------|----------------------------|
| 1 | Real external broker, not an in-memory array | Pass: RabbitMQ via `amqplib`; status in Redis | `rabbit.ts:32` (`assertQueue`), `docker-compose.yml` | Both containers `healthy` in `docker compose ps`; worker consumed orders from `orders.fulfillment` |
| 2 | API responds immediately (202), does not wait for the worker | Pass: 202 is sent after the broker confirms the publish, not after processing | `api.ts:87` (await publish confirm), `api.ts:97` (`.status(202)`) | Five rapid POSTs took 9, 7, 6, 5 and 6 ms and returned `orderId` + `queued`. TODO: show the literal `202 Accepted` on screen (`curl.exe -i` or DevTools Network tab) |
| 3 | Explicit ACK only after successful processing; no auto-ack | Pass: `noAck: false`; ACK only after the work and the status update | `worker.ts:74` (`noAck: false`), `worker.ts:50` (`channel.ack`) | Worker log shows `ACK` after each job finished |
| 4 | Durable queue and persistent messages | Pass: queue `durable: true`; messages `persistent: true` | `rabbit.ts:32`, `api.ts:50` | RabbitMQ UI Features shows `durable: true`. A message survived a hard kill of the worker and was redelivered (section 3, crash test) |

## 2. Beyond the four required items

| Check | What the code does (Read) | Result |
|-------|---------------------------|--------|
| Redelivery and idempotency | `worker.ts:46-51` runs the work every time a message arrives. It never checks whether the order is already `completed`. The `messageId` set at `api.ts:50` is never used by the worker. | **Ran: flaw confirmed.** The same order delivered twice was fulfilled twice (section 3, duplicate probe). |
| Poison messages / DLQ | `worker.ts:40` rejects malformed messages with `requeue=false`; the queue has no dead-letter settings (`rabbit.ts:32`). | **Ran: flaw confirmed.** The worker logged the rejection and the message was discarded. |
| Retry limits | `worker.ts:56` requeues immediately on any error, with no attempt counter or delay. | Read only. Not reproduced. |
| Status accuracy (`failed`) | `worker.ts` never sets `failed`. A rejected message (`worker.ts:38-41`) leaves no status update, and a failing order is reset to `queued` at `worker.ts:55`. Only the API sets `failed` (`api.ts:90`). | Read only. Not reproduced. |
| Status regression on redelivery | `worker.ts:47` sets `processing` on every delivery, even for a `completed` order. | Read only. The status flip was not captured during the duplicate probe. |
| Crash recovery | Messages are ACKed only after the work, so a killed worker leaves them unacked and the broker requeues them. | **Ran: works as designed** (a strength). Status stayed `processing` while the worker was dead; after restart the message came back with `redelivered=true` and completed. |
| Concurrency | `prefetch(1)` (`worker.ts:67`): one message at a time per worker. | **Ran: confirmed.** Unacked never exceeded 1 and jobs ran strictly one after another. |

Minor items seen during setup (Ran):

- `api.ts:117`: `app.listen` has no error handler. When port 3000 was taken, the API opened its RabbitMQ connection and then crashed with a raw `Unhandled 'error' event` stack trace (`EADDRINUSE`).
- The draft README has gaps on Windows: the `curl` command is bash-style (PowerShell aliases `curl` to `Invoke-WebRequest`), and it doesn't say Docker Desktop must be running (the first `docker compose up -d` failed until it was started).

## 3. Evidence log

### Smoke test: single order (Ran, 2026-11-17)

```text
[api] published order 13be6665-f804-473f-a615-01cca1b47c53
[worker] received 13be6665-f804-473f-a615-01cca1b47c53 (tag 1, redelivered=false)
[worker] fulfilling 13be6665-f804-473f-a615-01cca1b47c53 (1 item(s)) for ~3184ms
[worker] ACK 13be6665-f804-473f-a615-01cca1b47c53
```

Status API: `queued` at submit; `completed` with `createdAt` 06:52:30.929Z and `updatedAt` 06:52:34.131Z (about 3.2s). Port 3000 was already used by another local container, so this project ran with `PORT=3001`.

### Burst test (Ran)

Five POSTs in a row, timed in PowerShell: **9, 7, 6, 5, 6 ms**. Worker log for the five orders:

```text
[worker] received da4e3a6a-c282-4350-b5b3-206209e37f69 (tag 7, redelivered=false)
[worker] fulfilling da4e3a6a-c282-4350-b5b3-206209e37f69 (1 item(s)) for ~3781ms
[worker] ACK da4e3a6a-c282-4350-b5b3-206209e37f69
[worker] received a5274302-11ff-441c-8bd3-6ab0d87f16f4 (tag 8, redelivered=false)
[worker] fulfilling a5274302-11ff-441c-8bd3-6ab0d87f16f4 (1 item(s)) for ~3090ms
[worker] ACK a5274302-11ff-441c-8bd3-6ab0d87f16f4
[worker] received 33d3ea35-483b-47e8-bdc2-864815b13930 (tag 9, redelivered=false)
[worker] fulfilling 33d3ea35-483b-47e8-bdc2-864815b13930 (1 item(s)) for ~3169ms
[worker] ACK 33d3ea35-483b-47e8-bdc2-864815b13930
[worker] received 30efd3fa-b36b-4b9b-b519-ac3b80f3a898 (tag 10, redelivered=false)
[worker] fulfilling 30efd3fa-b36b-4b9b-b519-ac3b80f3a898 (1 item(s)) for ~4140ms
[worker] ACK 30efd3fa-b36b-4b9b-b519-ac3b80f3a898
[worker] received f395ea3f-79a0-4ada-8dd9-bf26fc483a62 (tag 11, redelivered=false)
[worker] fulfilling f395ea3f-79a0-4ada-8dd9-bf26fc483a62 (1 item(s)) for ~4643ms
[worker] ACK f395ea3f-79a0-4ada-8dd9-bf26fc483a62
```

Queue graph (RabbitMQ UI): Total peaked at about 4 with Ready at 3, Unacked never above 1, and drained to 0 in about 20 seconds (the five jobs add up to about 18.8s). Screenshot: `docs/burst-queue.png` (crop out the browser popup before committing).

### Poison message test (Ran)

Published the payload `not json` through the RabbitMQ UI. Worker log:

```text
[worker] rejecting message (tag 13): message body is not valid JSON
```

The message was not requeued (`nack` with `requeue=false`, `worker.ts:40`). TODO: screenshot of the Queues list showing only `orders.fulfillment` (no dead-letter queue exists) and Ready 0.

### Crash test (Ran)

Order `8e7a6e43-22b7-4253-a211-8cb28f959278`, worker running with a 30s job, force-killed about 6s in.

- Status while the worker was dead: `processing` (`createdAt` 08:10:11.690Z, `updatedAt` 08:10:11.696Z).
- Worker restarted:

```text
[worker] received 8e7a6e43-22b7-4253-a211-8cb28f959278 (tag 1, redelivered=true)
[worker] fulfilling 8e7a6e43-22b7-4253-a211-8cb28f959278 (1 item(s)) for ~3843ms
[worker] ACK 8e7a6e43-22b7-4253-a211-8cb28f959278
```

- Final status: `completed`. No message was lost.

### Duplicate-delivery probe (Ran)

Published the same order again through the RabbitMQ UI (same `orderId`, order already completed):

```text
[worker] received 8e7a6e43-22b7-4253-a211-8cb28f959278 (tag 2, redelivered=false)
[worker] fulfilling 8e7a6e43-22b7-4253-a211-8cb28f959278 (1 item(s)) for ~4022ms
[worker] ACK 8e7a6e43-22b7-4253-a211-8cb28f959278
```

The worker fulfilled an already-completed order a second time. `updatedAt` moved from the first completion to 08:11:05.642Z.

## 4. Flaws found and patches

Patch each in its own commit. Evidence column: "Ran" findings are safe to present in the video; "Read" findings should be described as code-review notes only.

| # | Flaw | Evidence | Why it matters in production | Planned patch (one commit each) |
|---|------|----------|------------------------------|---------------------------------|
| 1 | No dead-letter queue: malformed messages are discarded | **Ran** (poison test). Code: `worker.ts:40`, `rabbit.ts:32` | Bad payloads vanish with no way to inspect, alert or replay them | Declare a dead-letter exchange and `orders.fulfillment.dlq`, and route rejected messages there. Delete the existing queue in the RabbitMQ UI first, because RabbitMQ rejects changing the arguments of an existing queue. |
| 2 | No idempotency: a duplicate delivery repeats the work | **Ran** (duplicate probe). Code: `worker.ts:46-51` | Duplicate charges, emails or shipments after any redelivery | Skip and ACK when the order is already `completed`. |
| 3 | Unlimited immediate requeue, no retry cap or backoff | Read: `worker.ts:56` | A failing message loops forever, burning CPU and delaying the queue | Count attempts in a message header; after N failures send to the DLQ and mark the order `failed`. |
| 4 | Worker never sets `failed`; rejected or exhausted orders have no terminal status | Read: `worker.ts:38-41`, `worker.ts:55` | Clients polling the status endpoint can wait forever | Set `failed` with an error message on rejection and on retry exhaustion. |
| 5 | Status can go backwards (`completed` to `processing`) on a duplicate delivery | Read: `worker.ts:47` (status flip not captured live) | Clients see a finished order change state | Fixed by the idempotency check in #2. |

## 5. What the AI got right

- Real external broker (RabbitMQ) and Redis status store, both in Docker Compose with healthchecks and volumes.
- Durable queue and persistent messages (`rabbit.ts:32`, `api.ts:50`); a message survived a hard worker kill.
- Publisher confirms: the API only returns 202 after the broker accepts the message (`api.ts:44-55`, `api.ts:87`).
- Manual acknowledgments: `noAck: false`, ACK only after the work and the status update (`worker.ts:74`, `worker.ts:50`).
- `prefetch(1)`: one unacknowledged message per worker (`worker.ts:67`), confirmed in the burst test.
- Input validation with 400 responses (`validateOrder` in `api.ts`).
- Idiomatic REST: 202 with a `Location` header and a status URL; 404 for unknown orders; 503 plus a `failed` status if the publish fails (`api.ts:88-93`).
- Startup retry when the broker isn't ready yet, and exit-on-disconnect so a supervisor can restart the process (`rabbit.ts`).