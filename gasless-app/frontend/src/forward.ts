// Builds the ERC-2771 forward request that the wallet signs and the relayer sends.
// The signer pays nothing: they only sign typed data, and the relayer pays the gas to submit it.
import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem"
import { forwarderAbi, guestBookAbi } from "./abi"

/** EIP-712 types for OpenZeppelin's ERC2771Forwarder. They must match the contract exactly. */
export const forwardRequestTypes = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const

/** How long a signed request stays valid. After this the forwarder refuses it. */
const VALID_FOR_SECONDS = 10 * 60

/** Everything needed to ask the wallet for a signature. */
export async function buildRequest(
  client: PublicClient,
  { from, guestBook, forwarder, message }: { from: Address; guestBook: Address; forwarder: Address; message: string },
) {
  // The domain comes from the forwarder itself (EIP-5267), so it always matches what it checks.
  const [domainResult, nonce] = await Promise.all([
    client.readContract({ address: forwarder, abi: forwarderAbi, functionName: "eip712Domain" }),
    client.readContract({ address: forwarder, abi: forwarderAbi, functionName: "nonces", args: [from] }),
  ])
  const [, name, version, chainId, verifyingContract] = domainResult
  const data = encodeFunctionData({ abi: guestBookAbi, functionName: "sign", args: [message] })
  const gas = await estimateSignGas(client, from, guestBook, data, message)
  const deadline = Math.floor(Date.now() / 1000) + VALID_FOR_SECONDS

  return {
    domain: { name, version, chainId: Number(chainId), verifyingContract },
    message: { from, to: guestBook, value: 0n, gas, nonce, deadline, data },
  }
}

/** Gas for the inner GuestBook.sign call, with 20% headroom. */
async function estimateSignGas(client: PublicClient, from: Address, to: Address, data: Hex, message: string) {
  try {
    const estimate = await client.estimateGas({ account: from, to, data })
    return (estimate * 12n) / 10n
  } catch {
    // Each 32 bytes of message is one more storage slot.
    const bytes = BigInt(new TextEncoder().encode(message).length)
    return 80_000n + 25_000n * ((bytes + 31n) / 32n)
  }
}

export type RelayResult = { txHash: Hex; status: "success" | "reverted" | "pending"; paidBy: string; relayer: Address }

/** Posts the signed request to the relayer. Throws with the relayer's own message when it refuses. */
export async function relay(
  relayerUrl: string,
  request: { from: Address; to: Address; value: bigint; gas: bigint; deadline: number; data: Hex },
  signature: Hex,
): Promise<RelayResult> {
  let response: Response
  try {
    response = await fetch(`${relayerUrl}/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: {
          from: request.from,
          to: request.to,
          value: request.value.toString(),
          gas: request.gas.toString(),
          deadline: String(request.deadline),
          data: request.data,
          signature,
        },
      }),
    })
  } catch {
    throw new Error(`Could not reach the relayer at ${relayerUrl}. Is npm run relayer running?`)
  }
  const body = (await response.json().catch(() => ({}))) as Partial<RelayResult> & { error?: string }
  if (response.status === 429) {
    const wait = Number(response.headers.get("retry-after") ?? 0)
    throw new Error(`${body.error ?? "Too many requests."} Try again in ${Math.ceil(wait / 60)} minutes.`)
  }
  if (!response.ok || !body.txHash) throw new Error(body.error ?? `The relayer answered ${response.status}.`)
  return body as RelayResult
}
