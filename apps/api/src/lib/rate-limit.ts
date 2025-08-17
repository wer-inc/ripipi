import { FastifyRequest, FastifyReply } from 'fastify';

// シンプルなインメモリレート制限実装
class RateLimiter {
  private attempts: Map<string, { count: number; resetTime: number }> = new Map();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts: number = 100, windowMs: number = 60000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  async check(key: string): Promise<{ allowed: boolean; remainingAttempts: number; resetTime: number }> {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record || record.resetTime < now) {
      // 新しいウィンドウを開始
      const resetTime = now + this.windowMs;
      this.attempts.set(key, { count: 1, resetTime });
      return { allowed: true, remainingAttempts: this.maxAttempts - 1, resetTime };
    }

    if (record.count >= this.maxAttempts) {
      // レート制限に達した
      return { allowed: false, remainingAttempts: 0, resetTime: record.resetTime };
    }

    // カウントを増やす
    record.count++;
    return { allowed: true, remainingAttempts: this.maxAttempts - record.count, resetTime: record.resetTime };
  }

  // メモリクリーンアップ（古いエントリを削除）
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.attempts.entries()) {
      if (record.resetTime < now) {
        this.attempts.delete(key);
      }
    }
  }
}

// グローバルレート制限とエンドポイント別レート制限
const globalLimiter = new RateLimiter(1000, 60000); // 1分間に1000リクエスト
const authLimiter = new RateLimiter(10, 60000); // 認証エンドポイント: 1分間に10リクエスト
const reservationLimiter = new RateLimiter(50, 60000); // 予約エンドポイント: 1分間に50リクエスト

// 定期的なクリーンアップ
setInterval(() => {
  globalLimiter.cleanup();
  authLimiter.cleanup();
  reservationLimiter.cleanup();
}, 60000);

export async function rateLimitMiddleware(req: FastifyRequest, reply: FastifyReply) {
  // クライアントを識別（IPアドレス + ユーザーID）
  const clientIp = req.ip || 'unknown';
  const userId = (req as any).auth?.sub || 'anonymous';
  const key = `${clientIp}:${userId}`;

  // グローバルレート制限チェック
  const globalCheck = await globalLimiter.check(key);
  if (!globalCheck.allowed) {
    reply.header('X-RateLimit-Limit', '1000');
    reply.header('X-RateLimit-Remaining', '0');
    reply.header('X-RateLimit-Reset', new Date(globalCheck.resetTime).toISOString());
    reply.header('Retry-After', Math.ceil((globalCheck.resetTime - Date.now()) / 1000).toString());
    
    return reply.code(429).send({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: Math.ceil((globalCheck.resetTime - Date.now()) / 1000)
    });
  }

  // エンドポイント別レート制限
  const url = req.routeOptions?.url || '';
  let endpointLimiter: RateLimiter | null = null;
  let limit = 1000;

  if (url.startsWith('/auth')) {
    endpointLimiter = authLimiter;
    limit = 10;
  } else if (url.includes('/reservations')) {
    endpointLimiter = reservationLimiter;
    limit = 50;
  }

  if (endpointLimiter) {
    const endpointCheck = await endpointLimiter.check(`${key}:${url}`);
    if (!endpointCheck.allowed) {
      reply.header('X-RateLimit-Limit', limit.toString());
      reply.header('X-RateLimit-Remaining', '0');
      reply.header('X-RateLimit-Reset', new Date(endpointCheck.resetTime).toISOString());
      reply.header('Retry-After', Math.ceil((endpointCheck.resetTime - Date.now()) / 1000).toString());
      
      return reply.code(429).send({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded for ${url}. Please try again later.`,
        retryAfter: Math.ceil((endpointCheck.resetTime - Date.now()) / 1000)
      });
    }

    // レート制限ヘッダーを設定
    reply.header('X-RateLimit-Limit', limit.toString());
    reply.header('X-RateLimit-Remaining', endpointCheck.remainingAttempts.toString());
    reply.header('X-RateLimit-Reset', new Date(endpointCheck.resetTime).toISOString());
  }
}

export { RateLimiter };