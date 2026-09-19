// utils/rateLimiter.js
/**
 * Dependency-free sliding-window rate limiter (audit finding C2).
 *
 * Kenapa ditulis sendiri: project ini sengaja menjaga dependency tetap kecil
 * (lihat Sprint 4 audit — `youtubei.js`, `groq-sdk`, `multer` sudah tidak
 * dipakai). Satu limiter in-memory sederhana tidak sepadan dengan menambah
 * `express-rate-limit` beserta rantai dependensinya.
 *
 * Batasan yang disadari: state disimpan per-proses, jadi bila nanti dijalankan
 * multi-instance di belakang load balancer, limiter ini per-instance, bukan
 * global. Untuk skala sekarang (satu server + satu worker) ini memadai; bila
 * perlu global, pindahkan counter ke Redis.
 */

/**
 * @param {Object} options
 * @param {number} [options.windowMs=60000] - Panjang jendela waktu
 * @param {number} [options.max=30] - Maksimum request per jendela
 * @param {string} [options.message] - Pesan error saat limit tercapai
 * @param {Function} [options.keyGenerator] - Fungsi penentu identitas klien
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({
  windowMs = 60_000,
  max = 30,
  message = 'Terlalu banyak permintaan. Coba lagi nanti.',
  keyGenerator = defaultKeyGenerator,
} = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  let lastSweep = Date.now();

  // Buang entri lama agar Map tidak tumbuh tanpa batas pada trafik tinggi.
  function sweep(now) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    sweep(now);

    const key = keyGenerator(req);
    const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: message, retryAfterSeconds: retryAfterSec });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

function defaultKeyGenerator(req) {
  // `req.ip` menghormati trust proxy bila di-set; fallback ke socket address.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export default createRateLimiter;
