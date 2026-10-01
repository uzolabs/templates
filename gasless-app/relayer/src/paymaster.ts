// Optional, off by default: sends the relayer's transaction through a BOT Chain EOA paymaster.
//
// The flow: ask the paymaster `pm_isSponsorable` about the transaction. If it says yes, sign the
// same transaction with a gas price of 0 and send it to the paymaster with eth_sendRawTransaction.
// The paymaster then pays the gas, so the relayer wallet does not spend tBOT either.
//
// It is only used when PAYMASTER_URL is set. No public paymaster for BOT Chain mainnet (chain 677)
// is confirmed, and this adapter has not been run against a real one. If the paymaster says no, or
// fails, the relayer falls back to paying the gas itself.
import type { Address, Hex } from "viem"

export interface SponsorQuery {
  from: Address
  to: Address
  data: Hex
  value: bigint
  gas: bigint
}

export interface Paymaster {
  url: string
  isSponsorable(tx: SponsorQuery): Promise<boolean>
  sendRawTransaction(serialized: Hex): Promise<Hex>
}

const toQuantity = (value: bigint) => `0x${value.toString(16)}`

export function createPaymaster(url: string, fetchFn: typeof fetch = fetch): Paymaster {
  let id = 0
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Paymaster answered HTTP ${response.status} to ${method}`)
    const body = (await response.json()) as { result?: T; error?: { message?: string } }
    if (body.error) throw new Error(`Paymaster ${method} failed: ${body.error.message ?? "unknown error"}`)
    return body.result as T
  }

  return {
    url,
    async isSponsorable(tx) {
      const result = await call<{ sponsorable?: boolean } | boolean>("pm_isSponsorable", [
        { from: tx.from, to: tx.to, data: tx.data, value: toQuantity(tx.value), gas: toQuantity(tx.gas) },
      ])
      return typeof result === "boolean" ? result : result?.sponsorable === true
    },
    sendRawTransaction(serialized) {
      return call<Hex>("eth_sendRawTransaction", [serialized])
    },
  }
}

/** Returns a paymaster client when PAYMASTER_URL is set, otherwise undefined (the default). */
export function paymasterFromEnv(env = process.env): Paymaster | undefined {
  const url = env.PAYMASTER_URL?.trim()
  return url ? createPaymaster(url) : undefined
}
