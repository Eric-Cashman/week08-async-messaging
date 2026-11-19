## Week 08: Asynchronous Integration (REST API + RabbitMQ)

A decoupled order-fulfillment service. A synchronous REST API accepts orders and returns 202 Accepted immediately; a RabbitMQ queue buffers the work; a background worker fulfills orders and reports progress through a Redis status store.

Stack: Node.js, TypeScript, Express, RabbitMQ (amqplib), Redis (ioredis), Docker Compose
Live demo: N/A - Local Docker Architecture
Video walkthrough: TODO: paste the unlisted video link
Repository layout
Path	What it is
app/	The final, patched application (API, worker, dashboard, Docker Compose)
ai-draft/	The AI's first draft, committed untouched as the "before"
PROMPTS.md	The exact prompt log
AUDIT.md	Full audit: findings, test evidence, patches, known limitations
docs/	Evidence screenshots
Architecture topology and data flow
text
Client (browser dashboard / curl)
   | POST /api/orders -> 202 Accepted + orderId        GET /api/orders/:id -> status
   v                                                            ^
REST API (Express, producer) --publish--> RabbitMQ: orders.fulfillment (durable queue)
   | sets status: queued                          | consume, manual ACK, prefetch(1)
   v                                              v
Redis status store <-- processing / completed -- Worker (consumer)
                                                  | reject (malformed message)
                                                  v
                                  Dead-letter exchange orders.dlx -> orders.fulfillment.dlq
POST /api/orders validates the body, creates an order ID, records queued in Redis, publishes a persistent message to the durable queue, waits only for the broker's publisher confirm, and returns 202.
The worker consumes one message at a time (prefetch(1)), sets processing, simulates 3-5 seconds of work, sets completed, and only then sends an explicit ACK.
If the worker dies mid-job, the unacknowledged message returns to the queue and is redelivered.
Malformed messages are rejected without requeue and routed to the dead-letter queue for inspection.
A redelivered or duplicate message for an order that is already completed is ACKed and skipped (idempotency).
GET /api/orders/:id reads the status from Redis (queued, processing, completed, failed).
Prerequisites
Node.js 20+ and npm
Docker Desktop (running) with Docker Compose
Run guide

All commands run from the app/ folder. The examples are for Windows PowerShell, with bash equivalents where they differ.

1. Start RabbitMQ and Redis:

powershell
cd app
docker compose up -d
docker compose ps

Wait until both services show healthy. The RabbitMQ management UI is at http://localhost:15672 (user guest, password guest).

2. Install dependencies:

powershell
npm install

3. Start the API (terminal 1):

powershell
npm run dev:api

If port 3000 is already in use on your machine, set another port first: $env:PORT=3001 (PowerShell) or PORT=3001 (bash). The examples below use port 3000.

4. Start the worker (terminal 2):

powershell
npm run dev:worker

5. Submit a sample payload and poll for status (terminal 3):

PowerShell:

powershell
$r = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/orders -ContentType "application/json" -Body '{"customerId":"cust-1001","items":[{"sku":"ABC-123","quantity":2}]}'
$r
Invoke-RestMethod "http://localhost:3000/api/orders/$($r.orderId)"

bash / macOS / Linux:

bash
curl -i -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId":"cust-1001","items":[{"sku":"ABC-123","quantity":2}]}'

curl http://localhost:3000/api/orders/<orderId-from-the-response>

To see the raw 202 Accepted line on Windows, use curl.exe -i (in PowerShell, plain curl is an alias for Invoke-WebRequest).

6. Dashboard: open http://localhost:3000 to submit orders and watch each one move from queued to processing to completed.

Configuration (environment variables)
Variable	Default
PORT	3000
RABBITMQ_URL	amqp://guest:guest@localhost:5672
REDIS_URL	redis://localhost:6379
QUEUE_NAME	orders.fulfillment
DLX_NAME / DLQ_NAME	orders.dlx / orders.fulfillment.dlq
WORK_MIN_MS / WORK_MAX_MS	3000 / 5000
Troubleshooting
failed to connect to the docker API: Docker Desktop is not running yet.
EADDRINUSE on port 3000: another program uses the port; set PORT to a different value.
PRECONDITION_FAILED when starting the API or worker: a queue named orders.fulfillment already exists from an older version without the dead-letter settings. RabbitMQ will not change an existing queue's arguments. Delete it once (docker exec orders-rabbitmq rabbitmqctl delete_queue orders.fulfillment) and restart the worker.
AI disclosure and prompt appendix

AI tool used: Claude (configured model claude-sonnet-5-5)

Exact prompt submitted (also in PROMPTS.md):

text
Act as a senior distributed systems architect. Build a decoupled, event-driven order fulfillment service demonstrating synchronous REST ingestion and asynchronous message queue processing using Node.js with TypeScript and Express, and RabbitMQ (via amqplib).

The project must include:

Ingress REST API (Producer):
   - POST /api/orders: Validates input (customerId, and an items array of sku + quantity), generates a unique Order ID (this serves as the Job ID), pushes the payload onto a durable RabbitMQ queue, and IMMEDIATELY returns an HTTP 202 Accepted response with the Order ID.
   - GET /api/orders/:id: Returns the current order status ('queued', 'processing', 'completed', 'failed').

Message Broker and Status Store:
   - A running RabbitMQ instance (with the management UI) and a Redis instance used as the status store, both configured via Docker Compose.

Worker Service (Consumer):
   - Continuously listens on the queue.
   - Simulates fulfillment work (a 3-5 second processing delay).
   - Updates the order status in Redis upon completion.
   - Implements explicit message acknowledgments (ACK upon success, NACK/requeue on transient failure).

A lightweight frontend (plain HTML dashboard) showing:
   - A form to submit orders.
   - A live polling status indicator updating from 'queued' to 'processing' to 'completed'.

Provide the API code, worker consumer code, Docker Compose file, and step-by-step setup commands.
What the AI produced correctly
A real external broker (RabbitMQ) and Redis status store, with healthchecks and volumes in Docker Compose.
A durable queue and persistent messages; a message survived a hard kill of the worker.
Publisher confirms, so 202 is only returned after the broker has the message.
Manual acknowledgments (noAck: false, ACK only after the work and the status update) and prefetch(1).
Input validation with 400 responses, and idiomatic REST (202 with a Location header, 404 for unknown orders).
Flaws I found and patched
#	Flaw in the AI draft	How I found it	Fix	Commit
1	No dead-letter queue. A malformed message was rejected with requeue=false and silently discarded.	Published not json from the RabbitMQ UI; the worker logged the rejection and the message was gone.	Added dead-letter exchange orders.dlx and queue orders.fulfillment.dlq; the work queue now routes rejected messages there. Verified: the DLQ holds the message and the work queue is empty.	9495e5b
2	No idempotency. The worker redid the work on every delivery, so a duplicate message for a completed order was fulfilled twice (and the status went backwards).	Published the same completed order again; the worker ran another full fulfilling cycle.	The worker checks the order's status and ACKs and skips orders that are already completed. Verified: two duplicate deliveries logged already completed, ACK and skip with no fulfilling line.	5409044
Flaws noted but not patched
No retry cap or backoff: a transient error requeues the message immediately, forever (nack with requeue=true).
The worker never sets failed: dead-lettered orders stay queued from the client's point of view.
Idempotency is check-then-act: two workers could race on the same order; production would use an atomic claim (for example Redis SET NX).