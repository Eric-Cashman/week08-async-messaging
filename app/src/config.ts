export const config = {
  port: Number(process.env.PORT ?? 3000),
  rabbitUrl: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  queueName: process.env.QUEUE_NAME ?? "orders.fulfillment",
  dlxName: process.env.DLX_NAME ?? "orders.dlx",
  dlqName: process.env.DLQ_NAME ?? "orders.fulfillment.dlq",
  workMinMs: Number(process.env.WORK_MIN_MS ?? 3000),
  workMaxMs: Number(process.env.WORK_MAX_MS ?? 5000),
  statusTtlSeconds: Number(process.env.STATUS_TTL_SECONDS ?? 60 * 60 * 24),
};