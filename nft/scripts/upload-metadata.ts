// OPTIONAL. Pins one token's image and metadata to IPFS through Pinata. Nothing else in this
// template calls it, and UzoNFT does not need it: its tokenURI is generated on chain.
//
// Use it as a starting point if you change the contract to point tokenURI at IPFS instead
// (for example to use photos that are too large to store on chain).
//
//   npm run upload-metadata -- <tokenId>
//
// Needs PINATA_JWT in .env (create one at https://app.pinata.cloud/developers/api-keys).
// It reads the token's on-chain metadata, pins the SVG, then pins a copy of the JSON whose
// "image" points at the pinned SVG, and prints both ipfs:// links.
import { parseAbi } from "viem"
import { getDeployment } from "./lib/deployments.js"
import { fail, getClients, getNetwork, loadEnv, short } from "./lib/network.js"

const PINATA_API = "https://api.pinata.cloud/pinning"

loadEnv()
const jwt = process.env.PINATA_JWT?.trim()
if (!jwt)
  fail(
    "PINATA_JWT is not set, so there is nothing to do.",
    "This script is optional. Add a Pinata JWT to .env only if you want to pin metadata to IPFS.",
  )

const idText = process.argv.slice(2).find((arg) => !arg.startsWith("--"))
if (!idText || !/^\d+$/.test(idText)) fail("Missing token ID.", "Usage: npm run upload-metadata -- <tokenId>")
const tokenId = BigInt(idText)

const net = getNetwork()
const { publicClient } = getClients(net)
const nft = getDeployment(net.chain.id, "UzoNFT").address

let uri: string
try {
  uri = await publicClient.readContract({
    address: nft,
    abi: parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]),
    functionName: "tokenURI",
    args: [tokenId],
  })
} catch (error) {
  fail(`Could not read token #${tokenId}: ${short(error)}`, "Mint it first with npm run mint.")
}

const metadata = JSON.parse(decodeDataUri(uri, "data:application/json;base64,"))
const svg = decodeDataUri(metadata.image, "data:image/svg+xml;base64,")

const form = new FormData()
form.append("file", new Blob([svg], { type: "image/svg+xml" }), `uzo-nft-${tokenId}.svg`)
const image = await pinata("pinFileToIPFS", form)
console.log(`Pinned image:    ipfs://${image}`)

const json = await pinata(
  "pinJSONToIPFS",
  JSON.stringify({
    pinataMetadata: { name: `uzo-nft-${tokenId}.json` },
    pinataContent: { ...metadata, image: `ipfs://${image}` },
  }),
)
console.log(`Pinned metadata: ipfs://${json}`)

function decodeDataUri(value: string, prefix: string): string {
  if (!value.startsWith(prefix)) fail(`Expected a value starting with ${prefix}`)
  return Buffer.from(value.slice(prefix.length), "base64").toString("utf8")
}

async function pinata(endpoint: string, body: FormData | string): Promise<string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` }
  if (typeof body === "string") headers["Content-Type"] = "application/json"
  const response = await fetch(`${PINATA_API}/${endpoint}`, { method: "POST", headers, body })
  if (!response.ok)
    fail(
      `Pinata returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
      response.status === 401 ? "Check PINATA_JWT in .env." : undefined,
    )
  const { IpfsHash } = (await response.json()) as { IpfsHash: string }
  return IpfsHash
}
