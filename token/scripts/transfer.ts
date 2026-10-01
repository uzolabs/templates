// Sends UzoToken from your deployer wallet with viem.
//
//   npm run transfer -- <recipient> <amount>
//   npm run transfer -- 0x1234...abcd 25
//
// <amount> is in whole tokens (the script converts to 18 decimals for you).
import { erc20Abi } from "@uzolabs/sdk/contracts"
import { formatUnits, isAddress, parseUnits, type Address, type Hex } from "viem"
import { getDeployment } from "./lib/deployments.js"
import {
  assertChain,
  assertHasGas,
  confirmMainnet,
  fail,
  getClients,
  getNetwork,
  getPrivateKey,
  loadEnv,
  short,
  txUrl,
} from "./lib/network.js"

loadEnv()
const [to, amountText] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
if (!to || !amountText) fail("Missing arguments.", "Usage: npm run transfer -- <recipient address> <amount>")
if (!isAddress(to)) fail(`"${to}" is not a valid address.`)

const net = getNetwork()
const { publicClient, walletClient, account } = getClients(net, getPrivateKey())
const token = getDeployment(net.chain.id, "UzoToken").address
await assertChain(net)
await assertHasGas(net, account!.address)

const balanceOf = (who: Address) =>
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] })
const [decimals, symbol] = await Promise.all([
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
])
const amount = parseUnits(amountText, decimals)

const show = async (label: string) => {
  const [mine, theirs] = await Promise.all([balanceOf(account!.address), balanceOf(to)])
  console.log(
    `${label}: you ${formatUnits(mine, decimals)} ${symbol}, recipient ${formatUnits(theirs, decimals)} ${symbol}`,
  )
  return mine
}

const before = await show("Before")
if (before < amount) fail(`You only have ${formatUnits(before, decimals)} ${symbol}.`)
await confirmMainnet(net, `send ${amountText} ${symbol} to ${to}`)

let hash: Hex
try {
  // Simulate first so a revert shows a readable reason instead of a failed transaction.
  const { request } = await publicClient.simulateContract({
    account,
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  })
  hash = await walletClient!.writeContract(request)
} catch (error) {
  fail(`Transfer failed: ${short(error)}`)
}
console.log(`Sent. Waiting for confirmation: ${txUrl(net, hash)}`)
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== "success") fail(`Transaction reverted: ${txUrl(net, hash)}`)

await show("After ")
