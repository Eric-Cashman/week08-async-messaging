import amqp, { Channel, ConfirmChannel } from "amqplib";
import { config } from "./config";

export type Connection = Awaited<ReturnType<typeof amqp.connect>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connect to RabbitMQ, retrying while the broker is still starting up. */
export async function connectRabbit(retries = 10, delayMs = 2000): Promise<Connection> {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await amqp.connect(config.rabbitUrl);
      conn.on("error", (err: Error) => {
        console.error("[rabbit] connection error:", err.message);
      });
      conn.on("close", () => {
        console.error("[rabbit] connection closed - exiting so a supervisor can restart us");
        process.exit(1);
      });
      console.log("[rabbit] connected");
      return conn;
    } catch (err) {
      if (attempt >= retries) throw err;
      console.warn(`[rabbit] connect attempt ${attempt} failed, retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

/**
 * Declare the durable work queue plus its dead-letter exchange and queue.
 * Safe to call from both API and worker (they must declare identical arguments).
 */
export async function assertOrderQueue(channel: Channel | ConfirmChannel): Promise<void> {
  await channel.assertExchange(config.dlxName, "direct", { durable: true });
  await channel.assertQueue(config.dlqName, { durable: true });
  await channel.bindQueue(config.dlqName, config.dlxName, config.queueName);

  
  await channel.assertQueue(config.queueName, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": config.dlxName,
      "x-dead-letter-routing-key": config.queueName,
    },
  });
}