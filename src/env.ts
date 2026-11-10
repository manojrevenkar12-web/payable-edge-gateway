import type { PayerLedger } from "./ledger";
import type { SellerBook } from "./seller";
import type { SimChain, SimRegistry } from "./sim";

export interface Env {
  PAYER_LEDGER: DurableObjectNamespace<PayerLedger>;
  SELLER_BOOK: DurableObjectNamespace<SellerBook>;
  SIM_CHAIN: DurableObjectNamespace<SimChain>;
  SIM_REGISTRY: DurableObjectNamespace<SimRegistry>;
  SIM: string; // "1": simulated settlement, key directories and origin
  ADMIN_TOKEN: string;
  ORIGIN_URL?: string;
  FACILITATOR_URL?: string;
}
