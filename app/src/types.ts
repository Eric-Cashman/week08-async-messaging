export type OrderStatus = "queued" | "processing" | "completed" | "failed";

export interface OrderItem {
  sku: string;
  quantity: number;
}

/** The payload published to RabbitMQ. */
export interface OrderMessage {
  orderId: string;
  customerId: string;
  items: OrderItem[];
  createdAt: string;
}

/** What the status store (Redis) holds and GET /api/orders/:id returns. */
export interface OrderRecord {
  orderId: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
