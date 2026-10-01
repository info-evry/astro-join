/**
 * Setup for the happy-dom project.
 *
 * Newer Node versions ship an experimental global `localStorage` that throws
 * or is undefined without --localstorage-file and shadows happy-dom's. Install
 * a small in-memory Storage so the admin client's token persistence is tested
 * deterministically on every Node version.
 */
import { beforeEach } from 'vitest';

class MemoryStorage {
  #items = new Map();

  get length() {
    return this.#items.size;
  }

  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }

  setItem(key, value) {
    this.#items.set(String(key), String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }

  clear() {
    this.#items.clear();
  }
}

const storage = new MemoryStorage();
for (const target of new Set([globalThis, globalThis.window].filter(Boolean))) {
  Object.defineProperty(target, 'localStorage', { value: storage, configurable: true, writable: true });
}

beforeEach(() => {
  storage.clear();
});
