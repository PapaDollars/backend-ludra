/**
 * Petit cache mémoire à durée de vie (quota Firestore Spark, règle de coût n° 6).
 * Les valeurs renvoyées sont partagées : les appelants ne doivent pas les modifier.
 * Valable pour une seule instance (comme utils/userCache.js).
 */
class TtlCache {
  constructor({ ttlMs, max = 1000 }) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  delete(key) { this.map.delete(key); }

  clear() { this.map.clear(); }
}

module.exports = TtlCache;
