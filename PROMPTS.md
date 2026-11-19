# AI Prompt Log
Tool: Claude 
Date: 2026-11-17

## Prompt 1 (initial draft)

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