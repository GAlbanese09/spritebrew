export interface JobMessage {
  jobId: string;
  userId: string;
  idempotencyKey: string;
  tokenCost: number;
  mode: 'create' | 'animate';
  body: unknown;
  enqueuedAt: number;
  /**
   * Optional 64×64 opaque PNG base64 (no `data:` prefix). Consumer-side
   * fallback input for animation__any_animation (64-locked). Present on
   * animate messages when the client rendered one AND the total envelope
   * fits Cloudflare Queues' 128KB message cap. Consumer skips fallback
   * entirely when this field is missing AND the primary was >64px
   * (deterministic 400 on animation__any_animation).
   */
  fallbackInputImage?: string;
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
