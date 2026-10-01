// Signs the guest book from a brand new wallet that holds no BOT, through the relayer.
// It proves the whole gasless path from the command line.
//
//   npm run relayer                    in one terminal
//   npm run sign -- "hello"            in another (testnet)
//   npm run sign -- --direct "hello"   no relayer: your PRIVATE_KEY wallet calls the forwarder and pays the gas
//
// The new wallet's key is made up on the spot, kept in memory and thrown away afterwards.
import { encodeFunctionData, formatEther, parseAbi, type Address, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { getDeployment } from "./lib/deployments.js"
import { fail, getClients, getNetwork, getPrivateKey, loadEnv, short, txUrl } from "./lib/network.js"
import { forwarderAbi, forwardRequestTypes, guestBookAbi, toJson, type ForwardRequest } from "../relayer/src/forward.js"

loadEnv()
const net = getNetwork()
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const direct = process.argv.includes("--direct")
const message = args[0] || `gm from a wallet with 0 ${net.chain.nativeCurrency.symbol}`
const relayerUrl = process.env.RELAYER_URL || `http://localhost:${process.env.RELAYER_PORT || "8787"}`

const guestBook = getDeployment(net.chain.id, "GuestBook").address
const forwarder = getDeployment(net.chain.id, "UzoForwarder").address
const { publicClient } = getClients(net)
const readAbi = parseAbi([
  "struct Entry { address author; uint64 timestamp; string message; }",
  "function entryCount() view returns (uint256)",
  "function getEntries(uint256 offset, uint256 limit) view returns (Entry[])",
])

const signer = privateKeyToAccount(generatePrivateKey())
const before = await publicClient.getBalance({ address: signer.address })
console.log(`New wallet ${signer.address} holds ${formatEther(before)} ${net.chain.nativeCurrency.symbol}`)

// The EIP-712 domain comes from the forwarder itself, so it always matches what it checks.
const [, name, version, chainId, verifyingContract] = await publicClient.readContract({
  address: forwarder,
  abi: forwarderAbi,
  functionName: "eip712Domain",
})
const nonce = await publicClient.readContract({
  address: forwarder,
  abi: forwarderAbi,
  functionName: "nonces",
  args: [signer.address],
})
const data = encodeFunctionData({ abi: guestBookAbi, functionName: "sign", args: [message] })
const gas = await estimateSignGas(signer.address, data)
const deadline = Math.floor(Date.now() / 1000) + 10 * 60

const unsigned = { from: signer.address, to: guestBook, value: 0n, gas, nonce, deadline, data }
const signature = await signer.signTypedData({
  domain: { name, version, chainId, verifyingContract },
  types: forwardRequestTypes,
  primaryType: "ForwardRequest",
  message: unsigned,
})
const request: ForwardRequest = { from: signer.address, to: guestBook, value: 0n, gas, deadline, data, signature }
console.log(`Signed "${message}" (nonce ${nonce}, gas ${gas}, valid for 10 minutes)`)

let hash: Hex
if (direct) {
  const { walletClient, account } = getClients(net, getPrivateKey())
  console.log(`Sending it through the forwarder from ${account!.address}, which pays the gas`)
  hash = await walletClient!.writeContract({
    account: account!,
    chain: net.chain,
    address: forwarder,
    abi: forwarderAbi,
    functionName: "execute",
    args: [request],
  })
  await publicClient.waitForTransactionReceipt({ hash })
} else {
  console.log(`Posting it to the relayer at ${relayerUrl}`)
  let response: Response
  try {
    response = await fetch(`${relayerUrl}/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: toJson(request) }),
    })
  } catch (error) {
    fail(
      `Could not reach the relayer at ${relayerUrl} (${short(error)}).`,
      "Start it with npm run relayer in another terminal.",
    )
  }
  const body = (await response.json()) as { txHash?: Hex; status?: string; paidBy?: string; error?: string }
  if (!response.ok && response.status !== 202) fail(`The relayer refused: ${body.error ?? response.status}`)
  hash = body.txHash!
  console.log(`Gas paid by ${body.paidBy}. Status: ${body.status}`)
  if (body.status === "pending") await publicClient.waitForTransactionReceipt({ hash })
}
console.log(`  Tx: ${txUrl(net, hash)}`)

const count = await publicClient.readContract({ address: guestBook, abi: readAbi, functionName: "entryCount" })
const [newest] = await publicClient.readContract({
  address: guestBook,
  abi: readAbi,
  functionName: "getEntries",
  args: [count - 1n, 1n],
})
const after = await publicClient.getBalance({ address: signer.address })
console.log(`\nNewest entry (#${count - 1n} of ${count}): "${newest!.message}"`)
console.log(
  `  Author: ${newest!.author}${newest!.author === signer.address ? " (the new wallet, not the relayer)" : ""}`,
)
console.log(`  The new wallet still holds ${formatEther(after)} ${net.chain.nativeCurrency.symbol}`)
if (newest!.author !== signer.address)
  fail("The newest entry is not from the new wallet. Someone may have signed at the same moment; run it again.")

/** Gas for the inner GuestBook.sign call, with headroom. Each 32 bytes of message is one more storage slot. */
async function estimateSignGas(from: Address, callData: Hex): Promise<bigint> {
  try {
    const estimate = await publicClient.estimateGas({ account: from, to: guestBook, data: callData })
    return (estimate * 12n) / 10n
  } catch {
    const bytes = BigInt(new TextEncoder().encode(message).length)
    return 80_000n + 25_000n * ((bytes + 31n) / 32n)
  }
}
