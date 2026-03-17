// hash utility functions

// 2026-03-17 - Shaun L. Cloherty <s.cloherty@ieee.org>

function bin2hex(buf: ArrayBuffer) {
  const hex = Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

export async function sha256(str: string) {
  const utf8 = new TextEncoder().encode(str);
  return bin2hex(await crypto.subtle.digest("SHA-256", utf8));
}
