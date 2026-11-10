// The scripts run on Node, whose WebCrypto types live in node:crypto; the Worker code names them as globals.
import type { webcrypto } from "node:crypto";

declare global {
  type CryptoKey = webcrypto.CryptoKey;
  type CryptoKeyPair = webcrypto.CryptoKeyPair;
  type JsonWebKey = webcrypto.JsonWebKey;
}
export {};
