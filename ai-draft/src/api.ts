import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConfirmChannel } from "amqplib";
import { config } from "./config";
import { assertOrderQueue, connectRabbit } from "./rabbit";
import { createOrder, getOrder, setStatus } from "./statusStore";
import { OrderItem, OrderMessage } from "./types";

type ValidationResult =
  | { ok: true; customerId: string; items: OrderItem[] }
  | { ok: false; errors: string[] };

function validateOrder(body: unknown): ValidationResult {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const customerId = typeof b.customerId === "string" ? b.customerId.trim() : "";
  if (!customerId || customerId.length > 100) {
    errors.push("customerId must be a non-empty string (max 100 chars)");
  }

  const items: OrderItem[] = [];
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50) {
    errors.push("items must be an array with 1-50 entries");
  } else {
    b.items.forEach((raw, i) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const sku = typeof it.sku === "string" ? it.sku.trim() : "";
      const quantity = it.quantity;
      if (!sku || sku.length > 64) {
        errors.push(`items[${i}].sku must be a non-empty string (max 64 chars)`);
      }
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        errors.push(`items[${i}].quantity must be an integer between 1 and 1000`);
      }
      if (sku && typeof quantity === "number") items.push({ sku, quantity });
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, customerId, items };
}

/** Publish a persistent message and wait for the broker's publisher confirm. */
function publishOrder(channel: ConfirmChannel, message: OrderMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.sendToQueue(
      config.queueName,
      Buffer.from(JSON.stringify(message)),
      { persistent: true, contentType: "application/json", messageId: message.orderId },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function main() {
  const conn = await connectRabbit();
  const channel = await conn.createConfirmChannel();
  await assertOrderQueue(channel);

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Producer: validate, record as queued, publish, and return immediately.
  app.post("/api/orders", async (req, res) => {
    const result = validateOrder(req.body);
    if (!result.ok) {
      res.status(400).json({ error: "Invalid order", details: result.errors });
      return;
    }

    const orderId = randomUUID();
    const message: OrderMessage = {
      orderId,
      customerId: result.customerId,
      items: result.items,
      createdAt: new Date().toISOString(),
    };

    try {
      await createOrder(orderId);
      await publishOrder(channel, message);
    } catch (err) {
      console.error(`[api] failed to accept order ${orderId}:`, err);
      await setStatus(orderId, "failed", "could not be enqueued").catch(() => undefined);
      res.status(503).json({ error: "Unable to accept the order right now, please retry" });
      return;
    }

    console.log(`[api] published order ${orderId}`);
    res
      .status(202)
      .location(`/api/orders/${orderId}`)
      .json({ orderId, status: "queued", statusUrl: `/api/orders/${orderId}` });
  });

  // Status polling endpoint.
  app.get("/api/orders/:id", async (req, res) => {
    try {
      const order = await getOrder(req.params.id);
      if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      res.json(order);
    } catch (err) {
      console.error("[api] status lookup failed:", err);
      res.status(503).json({ error: "Status store unavailable" });
    }
  });

  app.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("[api] fatal startup error:", err);
  process.exit(1);
});
