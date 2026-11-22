// A tiny synchronous event bus: systems announce things, the HUD and missions listen.

export default class Events {
  constructor() {
    this.listeners = new Map();
  }

  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
    return () => this.off(name, handler);
  }

  off(name, handler) {
    const set = this.listeners.get(name);
    if (set) set.delete(handler);
  }

  emit(name, payload) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  clear() {
    this.listeners.clear();
  }
}
