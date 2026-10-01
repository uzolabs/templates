// Mints UzoNFT tokens from your deployer wallet with viem, then decodes the new token's on-chain metadata.
//
//   npm run mint                one token
//   npm run mint -- 3           three tokens (one transaction each)
//   npm run mint -- --mainnet   on mainnet (asks you to type MAINNET)
//
// It pays the current mintPrice for each token.
import { formatEther, parseAbi, type Address, type Hex } from "viem"
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

// Only the functions this script calls. The full ABI is in frontend/src/abi.ts after a deploy.
const nftAbi = parseAbi([
  "function mint() payable returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
])

loadEnv()
const countText = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "1"
if (!/^[1-9]\d*$/.test(countText) || Number(countText) > 20) fail(`Count must be a whole number from 1 to 20.`)
const count = Number(countText)

const net = getNetwork()
const { publicClient, walletClient, account } = getClients(net, getPrivateKey())
const me = account!.address
const nft = getDeployment(net.chain.id, "UzoNFT").address
await assertChain(net)
await assertHasGas(net, me)

const coin = net.chain.nativeCurrency.symbol
const contract = { address: nft, abi: nftAbi } as const

const show = async (label: string) => {
  const [native, owned, supply, max] = await Promise.all([
    publicClient.getBalance({ address: me }),
    publicClient.readContract({ ...contract, functionName: "balanceOf", args: [me] }),
    publicClient.readContract({ ...contract, functionName: "totalSupply" }),
    publicClient.readContract({ ...contract, functionName: "maxSupply" }),
  ])
  console.log(`${label}: you hold ${owned} NFT(s) and ${formatEther(native)} ${coin}. Minted ${supply} of ${max}.`)
  return { native, owned, supply, max }
}

const price = await publicClient.readContract({ ...contract, functionName: "mintPrice" })
const before = await show("Before")
if (before.supply + BigInt(count) > before.max) fail(`Only ${before.max - before.supply} token(s) left to mint.`)
if (before.native < price * BigInt(count))
  fail(`Minting ${count} costs ${formatEther(price * BigInt(count))} ${coin} plus gas.`)
console.log(`Mint price: ${formatEther(price)} ${coin}`)
await confirmMainnet(net, `mint ${count} NFT(s) for ${formatEther(price * BigInt(count))} ${coin}`)

for (let i = 0; i < count; i++) {
  let hash: Hex
  try {
    // Simulate first so a revert (wrong price, sold out) shows a readable reason.
    const { request } = await publicClient.simulateContract({
      account,
      ...contract,
      functionName: "mint",
      value: price,
    })
    hash = await walletClient!.writeContract(request)
  } catch (error) {
    fail(`Mint failed: ${short(error)}`)
  }
  console.log(`Minting ${i + 1} of ${count}. Waiting for confirmation: ${txUrl(net, hash)}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") fail(`Transaction reverted: ${txUrl(net, hash)}`)
}

const after = await show("After ")
// Read the newest token the same way the frontend does: by index, not from event logs.
const newest = await publicClient.readContract({
  ...contract,
  functionName: "tokenOfOwnerByIndex",
  args: [me, after.owned - 1n],
})
await describe(nft, newest)

async function describe(address: Address, tokenId: bigint) {
  const uri = await publicClient.readContract({ ...contract, functionName: "tokenURI", args: [tokenId] })
  const prefix = "data:application/json;base64,"
  if (!uri.startsWith(prefix)) return console.log(`Token #${tokenId} URI: ${uri}`)
  const metadata = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"))
  const hue = metadata.attributes?.find((a: { trait_type: string }) => a.trait_type === "Hue")?.value
  console.log(`\nNewest token: ${metadata.name} (hue ${hue})`)
  console.log(`  Image: an SVG of ${metadata.image.length} characters, stored on chain`)
  console.log(`  View:  ${net.explorerUrl}/token/${address}/instance/${tokenId}`)
}
