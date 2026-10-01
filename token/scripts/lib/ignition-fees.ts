// Hardhat network hook that gives Hardhat Ignition a priority fee BOT Chain accepts.
// Maintainers: this file is copied from _shared/scripts/lib/ignition-fees.ts. Edit it there, then run `npm run sync`.
//
// BOT Chain blocks have a base fee of 0. Ignition reads that as a free-gas chain and sends every
// transaction with maxFeePerGas and maxPriorityFeePerGas set to 0, which the node rejects as
// "transaction underpriced". When that happens, this hook asks the RPC for the fees it wants
// (eth_maxPriorityFeePerGas and the latest base fee) and puts them on the transaction.
// Transactions that already carry a fee are passed through unchanged.
import type { NetworkHooks } from "hardhat/types/hooks"

type RpcBlock = { baseFeePerGas?: string }

const isZero = (value: unknown) => typeof value === "string" && BigInt(value) === 0n

export default async (): Promise<Partial<NetworkHooks>> => ({
  async onRequest(context, connection, request, next) {
    const tx = Array.isArray(request.params) ? (request.params[0] as Record<string, unknown> | undefined) : undefined
    if (request.method === "eth_sendTransaction" && tx && isZero(tx.maxFeePerGas) && isZero(tx.maxPriorityFeePerGas)) {
      const provider = connection.provider
      const tip = BigInt((await provider.request({ method: "eth_maxPriorityFeePerGas" })) as string)
      if (tip > 0n) {
        const block = (await provider.request({
          method: "eth_getBlockByNumber",
          params: ["latest", false],
        })) as RpcBlock
        const baseFee = BigInt(block.baseFeePerGas ?? "0x0")
        const params = [...(request.params as unknown[])]
        // Same headroom rule Ignition and ethers use: twice the base fee plus the tip.
        params[0] = {
          ...tx,
          maxPriorityFeePerGas: `0x${tip.toString(16)}`,
          maxFeePerGas: `0x${(baseFee * 2n + tip).toString(16)}`,
        }
        return next(context, connection, { ...request, params })
      }
    }
    return next(context, connection, request)
  },
})
