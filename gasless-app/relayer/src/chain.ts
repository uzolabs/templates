// Everything the relayer does on chain, behind a small interface so the HTTP routes can be
// tested without a node (see relayer/test/app.test.ts).
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Address, type Hex } from "viem"
import { getClients, type NetworkInfo } from "../../scripts/lib/network.js"
import { forwarderAbi, revertReasons, type ForwardRequest } from "./forward.js"
import type { Paymaster } from "./paymaster.js"

export interface RelayChain {
  relayer: Address
  forwarder: Address
  chainId: number
  paymaster: boolean
  /** The forwarder's own check: target trusts it, deadline not passed, signature matches `from` and nonce. */
  verify(request: ForwardRequest): Promise<boolean>
  /** Dry-runs execute(). Throws Error with a readable reason if it would revert. */
  simulate(request: ForwardRequest): Promise<void>
  /** Sends execute() and returns the hash and who paid for it. */
  send(request: ForwardRequest): Promise<{ hash: Hex; paidBy: "relayer" | "paymaster" }>
  waitForReceipt(hash: Hex): Promise<"success" | "reverted" | "pending">
  getBalance(): Promise<bigint>
}

/** Turns a viem error into one short sentence for the API response. */
export function revertReason(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && revertReasons[name]) return revertReasons[name]
      if (name) return `The transaction would revert with ${name}.`
    }
    return error.shortMessage
  }
  return error instanceof Error ? error.message : String(error)
}

interface ChainOptions {
  net: NetworkInfo
  key: Hex
  forwarder: Address
  paymaster?: Paymaster
  log?: Pick<Console, "warn">
}

export function createChain({ net, key, forwarder, paymaster, log = console }: ChainOptions): RelayChain {
  const { publicClient, walletClient, account } = getClients(net, key)
  const relayer = account!.address

  // One transaction at a time, so two requests never pick the same relayer nonce.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  async function sendWithPaymaster(request: ForwardRequest): Promise<Hex | undefined> {
    if (!paymaster) return undefined
    try {
      const data = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [request] })
      const gas = await publicClient.estimateGas({ account: relayer, to: forwarder, data })
      if (!(await paymaster.isSponsorable({ from: relayer, to: forwarder, data, value: 0n, gas }))) return undefined
      const nonce = await publicClient.getTransactionCount({ address: relayer, blockTag: "pending" })
      const serialized = await walletClient!.signTransaction({
        account: account!,
        chain: net.chain,
        type: "legacy",
        to: forwarder,
        data,
        gas,
        gasPrice: 0n,
        nonce,
      })
      return await paymaster.sendRawTransaction(serialized)
    } catch (error) {
      log.warn(`Paymaster did not take the transaction, paying gas from the relayer instead: ${revertReason(error)}`)
      return undefined
    }
  }

  return {
    relayer,
    forwarder,
    chainId: net.chain.id,
    paymaster: Boolean(paymaster),
    verify: (request) =>
      publicClient.readContract({ address: forwarder, abi: forwarderAbi, functionName: "verify", args: [request] }),
    async simulate(request) {
      try {
        await publicClient.simulateContract({
          account: relayer,
          address: forwarder,
          abi: forwarderAbi,
          functionName: "execute",
          args: [request],
        })
      } catch (error) {
        throw new Error(revertReason(error))
      }
    },
    send: (request) =>
      serial(async () => {
        const sponsored = await sendWithPaymaster(request)
        if (sponsored) return { hash: sponsored, paidBy: "paymaster" as const }
        const hash = await walletClient!.writeContract({
          account: account!,
          chain: net.chain,
          address: forwarder,
          abi: forwarderAbi,
          functionName: "execute",
          args: [request],
        })
        return { hash, paidBy: "relayer" as const }
      }),
    async waitForReceipt(hash) {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
        return receipt.status
      } catch {
        return "pending"
      }
    },
    getBalance: () => publicClient.getBalance({ address: relayer }),
  }
}
