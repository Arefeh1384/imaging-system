// Browser storage can be blocked or cleared, so everything falls back to memory.
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    // Storage unavailable: use memory.
  }
  return memory.get(key) ?? null;
}

export function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    localStorage.setItem(key, raw);
  } catch {
    // Storage unavailable or full: memory still holds the value for this visit.
  }
}

export function removeKey(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

// The same, for values that should last only as long as the browser tab.
const tabMemory = new Map<string, string>();

export function readTabJson<T>(key: string): T | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    // Storage unavailable: use memory.
  }
  raw = raw ?? tabMemory.get(key) ?? null;
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeTabJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  tabMemory.set(key, raw);
  try {
    sessionStorage.setItem(key, raw);
  } catch {
    // Storage unavailable: memory still holds the value for this visit.
  }
}

export function removeTabKey(key: string): void {
  tabMemory.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
