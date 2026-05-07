export interface JobMessage {
  jobId: string;
  userId: string;
  idempotencyKey: string;
  tokenCost: number;
  mode: 'create' | 'animate';
  body: unknown;
  enqueuedAt: number;
}

interface QueueBinding {
  send(message: JobMessage, options?: { delaySeconds?: number }): Promise<void>;
}

export async function enqueueJob(
  queue: unknown,
  msg: JobMessage
): Promise<void> {
  const q = queue as QueueBinding;
  if (!q || typeof q.send !== 'function') {
    throw new Error('Queue binding RD_QUEUE missing or invalid');
  }
  await q.send(msg);
}
