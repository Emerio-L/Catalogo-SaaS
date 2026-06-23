class MemoryCache {
    constructor(defaultTtlMs = 120000) { // 2 minutos por defecto
        this.cache = new Map();
        this.defaultTtlMs = defaultTtlMs;
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        return item.value;
    }

    set(key, value, ttlMs = null) {
        const ttl = ttlMs !== null ? ttlMs : this.defaultTtlMs;
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl
        });
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    // Limpia todas las llaves que comiencen con un prefijo (ej. el ID o slug del tenant)
    clearPrefix(prefix) {
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }
}

const sharedCache = new MemoryCache();

module.exports = {
    MemoryCache,
    sharedCache
};
