# Order Fulfillment: REST ingestion + RabbitMQ worker

```
Browser / curl
    |  POST /api/orders  (202 Accepted + orderId)
    v
Express API (producer) --publish--> RabbitMQ queue "orders.fulfillment" --consume--> Worker
    |                                                                                  |
    +------------------------ Redis status store <------------------------------------+
         GET /api/orders/:id  (queued -> processing -> completed)
```

## Prerequisites

- Node.js 20+ and npm
- Docker with Docker Compose

## Run it

1. Start RabbitMQ and Redis:

   ```bash
   docker compose up -d
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the API (terminal 1):

   ```bash
   npm run dev:api
   ```

4. Start the worker (terminal 2):

   ```bash
   npm run dev:worker
   ```

5. Submit an order and poll for status:

   ```bash
   curl -i -X POST http://localhost:3000/api/orders \
     -H "Content-Type: application/json" \
     -d '{"customerId":"cust-1001","items":[{"sku":"ABC-123","quantity":2}]}'

   curl http://localhost:3000/api/orders/<orderId-from-the-response>
   ```

6. Open the dashboard at http://localhost:3000 and the RabbitMQ management UI at
   http://localhost:15672 (user `guest`, password `guest`).

## Configuration (environment variables)

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` |
| `REDIS_URL` | `redis://localhost:6379` |
| `QUEUE_NAME` | `orders.fulfillment` |
| `WORK_MIN_MS` / `WORK_MAX_MS` | `3000` / `5000` |
