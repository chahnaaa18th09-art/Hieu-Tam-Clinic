const buckets = new Map();

function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 30, keyGenerator } = {}) {
    // Dọn dẹp định kỳ để tránh rò rỉ bộ nhớ trong thời gian chạy dài.
    const cleanup = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets.entries()) {
            if (bucket.resetAt <= now) buckets.delete(key);
        }
    }, windowMs);
    if (typeof cleanup.unref === 'function') cleanup.unref();

    return function rateLimitMiddleware(req, res, next) {
        const key = keyGenerator ? keyGenerator(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;

        if (bucket.count > max) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                success: false,
                message: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.'
            });
        }
        next();
    };
}

module.exports = { createRateLimiter };