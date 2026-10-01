// Sending transactions from the dex scripts: approvals, confirmation and BOTScan links.
import { erc20Abi, type Address, type Hex, type PublicClient, type WalletClient, type Account } from "viem"
import type { Token } from "../../frontend/src/dex/routes.js"
import { formatToken } from "./cli.js"
import {
  assertChain,
  assertHasGas,
  fail,
  getClients,
  getNetwork,
  getPrivateKey,
  short,
  txUrl,
  type NetworkInfo,
} from "./network.js"

export type Signer = { publicClient: PublicClient; walletClient: WalletClient; account: Account; net: NetworkInfo }

/** Clients for PRIVATE_KEY's wallet, after checking the RPC is the right chain and the wallet has gas money. */
export async function getSigner(): Promise<Signer> {
  const net = getNetwork()
  const { publicClient, walletClient, account } = getClients(net, getPrivateKey())
  await assertChain(net)
  await assertHasGas(net, account!.address)
  return { publicClient, walletClient: walletClient!, account: account!, net }
}

/**
 * Runs `write` (which should simulate first, so a revert shows its reason), prints the BOTScan link
 * and waits for the receipt. Stops the script if the transaction fails.
 */
export async function sendAndWait(signer: Signer, label: string, write: () => Promise<Hex>): Promise<Hex> {
  let hash: Hex
  try {
    hash = await write()
  } catch (error) {
    fail(`${label} failed: ${short(error)}`)
  }
  console.log(`${label}: waiting for confirmation. ${txUrl(signer.net, hash)}`)
  const receipt = await signer.publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") fail(`${label} reverted: ${txUrl(signer.net, hash)}`)
  return hash
}

/**
 * Lets `spender` move `amount` of `token` for you, if it cannot already. Approves the exact amount,
 * not "unlimited", so a bug in the spender can never take more than this one trade needs.
 */
export async function approveIfNeeded(signer: Signer, token: Token, spender: Address, amount: bigint) {
  if (token.isNative) return
  const { publicClient, walletClient, account } = signer
  const allowance = await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, spender],
  })
  if (allowance >= amount) return console.log(`Allowance: already enough ${token.symbol} approved.`)
  await sendAndWait(signer, `Approve ${formatToken(amount, token)}`, async () => {
    const { request } = await publicClient.simulateContract({
      account,
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    })
    return walletClient.writeContract(request)
  })
}
