import { getMeta, setMeta } from './db';

let userId = '';
let device = '';
let role: 'reviewee' | 'supporter' = 'reviewee';

export function uuid(): string {
  return crypto.randomUUID();
}

/** Loads (or creates) the device id and the local user id used before sign-in. */
export async function initIdentity(): Promise<void> {
  device = await getMeta<string>('deviceId', '');
  if (!device) {
    device = uuid();
    await setMeta('deviceId', device);
  }
  userId = await getMeta<string>('userId', '');
  if (!userId) {
    userId = uuid();
    await setMeta('userId', userId);
    await setMeta('localUserId', userId);
  }
  role = await getMeta<'reviewee' | 'supporter'>('role', 'reviewee');
}

export function getUserId(): string {
  return userId;
}

export async function setUserId(id: string): Promise<void> {
  userId = id;
  await setMeta('userId', id);
}

export function getDeviceId(): string {
  return device;
}

export function getRole(): 'reviewee' | 'supporter' {
  return role;
}

export async function setRole(r: 'reviewee' | 'supporter'): Promise<void> {
  role = r;
  await setMeta('role', r);
}

/**
 * A stable UUID derived from a name, so seed rows created offline on two
 * devices get the same ids and merge instead of duplicating.
 */
export async function stableId(...parts: string[]): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|'))),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
