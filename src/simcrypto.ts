/** Pure helpers of the simulated network, shared by the Worker, the tests and the simulator (no Workers imports). */

import { b64urlToBytes } from "./webbotauth";
import type { Authorization } from "./x402";

const enc = new TextEncoder();

export function authorizationMessage(network: string, a: Authorization): Uint8Array {
  return enc.encode(
    `x402-sim:${network}:${JSON.stringify([a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce])}`,
  );
}

export async function addressOf(publicKeyB64url: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", b64urlToBytes(publicKeyB64url)));
  return `0x${[...h.slice(0, 20)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

