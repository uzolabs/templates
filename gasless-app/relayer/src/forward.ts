// The forward request shape, its ABI, and the checks the relayer runs before it spends gas.
// Used by the relayer server and by scripts/sign.ts. The web app has its own copy of the
// EIP-712 types in frontend/src/forward.ts, because it is built separately.
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem"

export const forwarderAbi = parseAbi([
  "struct ForwardRequestData { address from; address to; uint256 value; uint256 gas; uint48 deadline; bytes data; bytes signature; }",
  "function execute(ForwardRequestData request) payable",
  "function verify(ForwardRequestData request) view returns (bool)",
  "function nonces(address owner) view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "error ERC2771ForwarderInvalidSigner(address signer, address from)",
  "error ERC2771ForwarderMismatchedValue(uint256 requestedValue, uint256 msgValue)",
  "error ERC2771ForwarderExpiredRequest(uint48 deadline)",
  "error ERC2771UntrustfulTarget(address target, address forwarder)",
  "error FailedCall()",
])

/** Plain-language reasons for the forwarder's errors. FailedCall means GuestBook.sign itself reverted. */
export const revertReasons: Record<string, string> = {
  ERC2771ForwarderInvalidSigner: "The signature does not match the request, or it was already used. Sign again.",
  ERC2771ForwarderExpiredRequest: "The request has expired. Sign it again.",
  ERC2771UntrustfulTarget: "The guest book does not trust this forwarder.",
  ERC2771ForwarderMismatchedValue: "The request asks for BOT to be sent, which this relayer does not do.",
  FailedCall: "The guest book refused the message. Check that it is not empty and at most 280 bytes.",
}

export const guestBookAbi = parseAbi(["function sign(string message) returns (uint256 id)"])

/** The only function the relayer will pay for. */
export const SIGN_SELECTOR = toFunctionSelector("sign(string)")

/** Matches MAX_MESSAGE_LENGTH in contracts/GuestBook.sol. The contract is still the final check. */
export const MAX_MESSAGE_BYTES = 280

/** EIP-712 types for a request. The forwarder adds the signer's current nonce when it checks. */
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

/** A signed request as it travels over HTTP: numbers are decimal strings because JSON has no bigint. */
export interface ForwardRequestJson {
  from: string
  to: string
  value: string
  gas: string
  deadline: string
  data: string
  signature: string
}

/** The same request, ready for the forwarder's ABI. */
export interface ForwardRequest {
  from: Address
  to: Address
  value: bigint
  gas: bigint
  deadline: number
  data: Hex
  signature: Hex
}

export function toJson(request: ForwardRequest): ForwardRequestJson {
  return {
    from: request.from,
    to: request.to,
    value: request.value.toString(),
    gas: request.gas.toString(),
    deadline: String(request.deadline),
    data: request.data,
    signature: request.signature,
  }
}

export interface RelayPolicy {
  guestBook: Address
  /** The most gas a request may ask the forwarder to pass on. Stops a signer from draining the relayer. */
  maxGas: bigint
  /** Current time in seconds. */
  now: number
}

/** A request the relayer refuses, with the HTTP status to answer with. */
export class RelayError extends Error {
  constructor(
    readonly status: 400 | 403 | 429 | 502 | 503,
    message: string,
  ) {
    super(message)
  }
}

const UINT = /^\d{1,78}$/

/**
 * Parses an untrusted request body and applies the allowlists. Throws RelayError.
 * Nothing here touches the chain; the signature is checked afterwards with the forwarder's `verify`.
 */
export function checkRequest(body: unknown, policy: RelayPolicy): ForwardRequest {
  const raw = (body as { request?: unknown } | null)?.request
  if (!raw || typeof raw !== "object") throw new RelayError(400, 'Send JSON like { "request": { ... } }.')
  const r = raw as Record<string, unknown>
  for (const field of ["from", "to", "value", "gas", "deadline", "data", "signature"]) {
    if (typeof r[field] !== "string") throw new RelayError(400, `request.${field} must be a string.`)
  }
  const json = r as unknown as ForwardRequestJson
  if (!isAddress(json.from) || !isAddress(json.to))
    throw new RelayError(400, "request.from and request.to must be addresses.")
  if (!UINT.test(json.value) || !UINT.test(json.gas) || !UINT.test(json.deadline))
    throw new RelayError(400, "request.value, gas and deadline must be whole numbers.")
  if (!isHex(json.data) || !isHex(json.signature)) throw new RelayError(400, "request.data and signature must be hex.")
  // A sign() call with a 280 byte message is under 400 bytes of calldata.
  if (json.data.length > 2 + 2 * 1024) throw new RelayError(400, "request.data is too long.")
  if (json.signature.length !== 2 + 2 * 65) throw new RelayError(400, "request.signature must be 65 bytes.")

  const request: ForwardRequest = {
    from: getAddress(json.from),
    to: getAddress(json.to),
    value: BigInt(json.value),
    gas: BigInt(json.gas),
    deadline: Number(json.deadline),
    data: json.data,
    signature: json.signature,
  }

  if (request.to !== getAddress(policy.guestBook))
    throw new RelayError(403, "This relayer only pays for calls to the guest book.")
  if (request.data.slice(0, 10).toLowerCase() !== SIGN_SELECTOR)
    throw new RelayError(403, "This relayer only pays for GuestBook.sign.")
  if (request.value !== 0n) throw new RelayError(400, "request.value must be 0. The relayer does not send BOT.")
  if (request.gas === 0n || request.gas > policy.maxGas)
    throw new RelayError(400, `request.gas must be between 1 and ${policy.maxGas}.`)
  if (!Number.isSafeInteger(request.deadline) || request.deadline < policy.now)
    throw new RelayError(400, "The request has expired. Sign it again.")

  let message: string
  try {
    message = decodeFunctionData({ abi: guestBookAbi, data: request.data }).args[0]
  } catch {
    throw new RelayError(400, "request.data is not a valid GuestBook.sign call.")
  }
  const bytes = new TextEncoder().encode(message).length
  if (bytes === 0) throw new RelayError(400, "The message is empty.")
  if (bytes > MAX_MESSAGE_BYTES)
    throw new RelayError(400, `The message is ${bytes} bytes; the limit is ${MAX_MESSAGE_BYTES}.`)

  return request
}
