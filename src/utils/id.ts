// wrappers and utils for creating bookmark IDs
//
// note: the active scheme, unencrypted (SHA-256) vs encrypted (HMAC-SHA256)
//       is determined by the caller.

// 2026-03-31 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { normalize } from './url';
import { sha256 } from './hash';

// HMAC-SHA256(key, input) — returns a hex string, same length as sha256()
export async function hmac(key: CryptoKey, input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// compute a bookmark ID from a URL using SHA-256 (unencryted scheme)
export async function sha256Id(href: string): Promise<string> {
  return sha256(normalize(href));
}

// compute a bookmark ID from a URL using HMAC-SHA256 (encrypted scheme)
export async function hmacId(key: CryptoKey, href: string): Promise<string> {
  return hmac(key, normalize(href));
}

export default { sha256Id, hmacId, hmac };
