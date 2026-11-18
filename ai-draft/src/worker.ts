import { Channel, ConsumeMessage } from "amqplib";
import { config } from "./config";
import { assertOrderQueue, connectRabbit } from "./rabbit";
import { setStatus } from "./statusStore";
import { OrderMessage } from "./types";

/** Thrown for problems that retrying can never fix (bad payload shape). */
class PermanentError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseOrder(msg: ConsumeMessage): OrderMessage {
  let parsed: any;
  try {
    parsed = JSON.parse(msg.content.toString());
  } catch {
    throw new PermanentError("message body is not valid JSON");
  }
  if (!parsed || typeof parsed.orderId !== "string" || !Array.isArray(parsed.items)) {
    throw new PermanentError("message is missing orderId or items");
  }
  return parsed as OrderMessage;
}

/** Simulated fulfillment: takes 3-5 seconds. */
async function fulfillOrder(order: OrderMessage): Promise<void> {
  const duration = config.workMinMs + Math.random() * (config.workMaxMs - config.workMinMs);
  console.log(`[worker] fulfilling ${order.orderId} (${order.items.length} item(s)) for ~${Math.round(duration)}ms`);
  await sleep(duration);
}

async function handleMessage(channel: Channel, msg: ConsumeMessage): Promise<void> {
  const tag = msg.fields.deliveryTag;
  let order: OrderMessage;

  try {
    order = parseOrder(msg);
  } catch (err) {
    console.error(`[worker] rejecting message (tag ${tag}): ${(err as Error).message}`);
    channel.nack(msg, false, false); // requeueing cannot help
    return;
  }

  console.log(`[worker] received ${order.orderId} (tag ${tag}, redelivered=${msg.fields.redelivered})`);

  try {
    await setStatus(order.orderId, "processing");
    await fulfillOrder(order);
    await setStatus(order.orderId, "completed");
    channel.ack(msg); // acknowledge only after the work and the status update succeeded
    console.log(`[worker] ACK ${order.orderId}`);
  } catch (err) {
    // Treat everything else as transient: put the message back on the queue.
    console.error(`[worker] transient failure on ${order.orderId}:`, err);
    await setStatus(order.orderId, "queued").catch(() => undefined);
    channel.nack(msg, false, true);
    console.warn(`[worker] NACK (requeue) ${order.orderId}`);
  }
}

async function main() {
  const conn = await connectRabbit();
  const channel = await conn.createChannel();
  await assertOrderQueue(channel);

  // One unacknowledged message at a time per worker.
  await channel.prefetch(1);

  await channel.consume(
    config.queueName,
    (msg) => {
      if (msg) void handleMessage(channel, msg);
    },
    { noAck: false }
  );

  console.log(`[worker] waiting for messages on "${config.queueName}"`);
}

main().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});
