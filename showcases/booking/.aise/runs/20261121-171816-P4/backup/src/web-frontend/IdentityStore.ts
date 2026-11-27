interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'identity';

/**
 * Browser-side storage of name and email in localStorage.
 *
 * @trace DSN-014 REQ-008
 */
export class IdentityStore {
  private readonly memory: Map<string, string> = new Map<string, string>();

  constructor(public name: string | null, public email: string | null) {}

  load(): { name: string; email: string; } | null {
    const raw = this.readRaw();
    if (raw === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { name?: unknown }).name !== 'string' ||
      typeof (parsed as { email?: unknown }).email !== 'string'
    ) {
      return null;
    }
    const identity = parsed as { name: string; email: string };
    this.name = identity.name;
    this.email = identity.email;
    return { name: identity.name, email: identity.email };
  }

  save(name: string, email: string): void {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length === 0) {
      throw new Error('Name is required');
    }
    if (trimmedEmail.length === 0) {
      throw new Error('Email is required');
    }
    const value = JSON.stringify({ name: trimmedName, email: trimmedEmail });
    this.writeRaw(value);
    this.name = trimmedName;
    this.email = trimmedEmail;
  }

  private getStorage(): StorageLike | null {
    const candidate = (globalThis as unknown as { localStorage?: StorageLike }).localStorage;
    return candidate ?? null;
  }

  private readRaw(): string | null {
    const storage = this.getStorage();
    if (storage !== null) {
      return storage.getItem(STORAGE_KEY);
    }
    return this.memory.get(STORAGE_KEY) ?? null;
  }

  private writeRaw(value: string): void {
    const storage = this.getStorage();
    if (storage !== null) {
      storage.setItem(STORAGE_KEY, value);
      return;
    }
    this.memory.set(STORAGE_KEY, value);
  }
}
