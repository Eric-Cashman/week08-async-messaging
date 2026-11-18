import Redis from "ioredis";
import { config } from "./config";
import { OrderRecord, OrderStatus } from "./types";

export const redis = new Redis(config.redisUrl);

redis.on("error", (err) => {
  console.error("[redis] error:", err.message);
});

const key = (orderId: string) => `order:${orderId}`;

export async function createOrder(orderId: string): Promise<void> {
  const now = new Date().toISOString();
  await redis
    .multi()
    .hset(key(orderId), { status: "queued", createdAt: now, updatedAt: now })
    .expire(key(orderId), config.statusTtlSeconds)
    .exec();
}

export async function setStatus(
  orderId: string,
  status: OrderStatus,
  error?: string
): Promise<void> {
  const fields: Record<string, string> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (error) fields.error = error;
  await redis.hset(key(orderId), fields);
}

export async function getOrder(orderId: string): Promise<OrderRecord | null> {
  const data = await redis.hgetall(key(orderId));
  if (!data || Object.keys(data).length === 0) return null;
  return {
    orderId,
    status: data.status as OrderStatus,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    ...(data.error ? { error: data.error } : {}),
  };
}
