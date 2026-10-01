// Token list, pool lookups and quotes for BDEX V2 and V3. Shared by the scripts and the web app.
// Every address comes from @uzolabs/sdk/contracts, and pools are looked up on chain, never hard-coded.
import {
  bdexV2FactoryAbi,
  bdexV2Router02Abi,
  bdexV3FactoryAbi,
  bdexV3QuoterV2Abi,
  getAddresses,
  TOKENS,
} from "@uzolabs/sdk/contracts"
import { zeroAddress, type Address, type PublicClient } from "viem"
import { feeLabel, V3_FEES, type V3Fee } from "./math.js"

export type DexChainId = Parameters<typeof getAddresses>[0]
export type AddressBook = ReturnType<typeof getAddresses<DexChainId>>

export type TokenSymbol = "BOT" | "WBOT" | "USDT"
export const SYMBOLS: readonly TokenSymbol[] = ["BOT", "WBOT", "USDT"]

export type Token = {
  symbol: TokenSymbol
  decimals: number
  /** The ERC-20 used in pools. Native BOT trades through WBOT, so it shares WBOT's address. */
  address: Address
  /** True for BOT itself, which is sent as transaction value instead of approved. */
  isNative: boolean
}

export function getTokens(book: AddressBook): Record<TokenSymbol, Token> {
  return {
    BOT: { symbol: "BOT", decimals: TOKENS.BOT.decimals, address: book.wbot, isNative: true },
    WBOT: { symbol: "WBOT", decimals: TOKENS.BOT.decimals, address: book.wbot, isNative: false },
    // USDT has 6 decimals, not 18. Always format and parse it with its own decimals.
    USDT: { symbol: "USDT", decimals: TOKENS.USDT.decimals, address: book.usdt, isNative: false },
  }
}

/** Case-insensitive lookup of "bot", "WBOT", "usdt". */
export function parseSymbol(text: string | undefined): TokenSymbol | undefined {
  const upper = (text ?? "").trim().toUpperCase()
  return SYMBOLS.find((s) => s === upper)
}

/**
 * What a trade between two tokens needs. BOT and WBOT are always 1:1, so they never touch a pool:
 * BOT to WBOT is WBOT.deposit() and WBOT to BOT is WBOT.withdraw().
 */
export function tradeKind(from: TokenSymbol, to: TokenSymbol): "same" | "wrap" | "unwrap" | "swap" {
  if (from === to) return "same"
  if (from === "BOT" && to === "WBOT") return "wrap"
  if (from === "WBOT" && to === "BOT") return "unwrap"
  return "swap"
}

export type V2Quote = { version: "V2"; amountOut: bigint }
export type V3Quote = { version: "V3"; fee: V3Fee; amountOut: bigint; gasEstimate: bigint }
export type Quote = V2Quote | V3Quote

export const routeLabel = (q: Quote) => (q.version === "V2" ? "BDEX V2" : `BDEX V3, ${feeLabel(q.fee)} pool`)

/** The V2 pair for two tokens, or undefined if nobody has created it. */
export async function findV2Pair(client: PublicClient, book: AddressBook, a: Address, b: Address) {
  const pair = await client.readContract({
    address: book.bdexV2Factory,
    abi: bdexV2FactoryAbi,
    functionName: "getPair",
    args: [a, b],
  })
  return pair === zeroAddress ? undefined : pair
}

/** Every V3 pool for two tokens, one per fee tier. Tiers without a pool are skipped. */
export async function findV3Pools(client: PublicClient, book: AddressBook, a: Address, b: Address) {
  const pools = await Promise.all(
    V3_FEES.map(async (fee) => {
      const pool = await client.readContract({
        address: book.bdexV3Factory,
        abi: bdexV3FactoryAbi,
        functionName: "getPool",
        args: [a, b, fee],
      })
      return { fee, pool }
    }),
  )
  return pools.filter((p) => p.pool !== zeroAddress)
}

/** V2 price for `amountIn`, from Router02.getAmountsOut. Undefined when there is no pair or no liquidity. */
export async function quoteV2(
  client: PublicClient,
  book: AddressBook,
  amountIn: bigint,
  tokenIn: Address,
  tokenOut: Address,
): Promise<V2Quote | undefined> {
  try {
    const amounts = await client.readContract({
      address: book.bdexV2Router02,
      abi: bdexV2Router02Abi,
      functionName: "getAmountsOut",
      args: [amountIn, [tokenIn, tokenOut]],
    })
    const amountOut = amounts.at(-1) ?? 0n
    return amountOut > 0n ? { version: "V2", amountOut } : undefined
  } catch {
    return undefined
  }
}

/**
 * V3 price for one fee tier, from QuoterV2.quoteExactInputSingle. That function is not marked `view`
 * (it runs the swap and reverts with the result), so it is called with simulateContract, which never
 * sends a transaction. Undefined when the pool cannot fill the trade.
 */
export async function quoteV3(
  client: PublicClient,
  book: AddressBook,
  amountIn: bigint,
  tokenIn: Address,
  tokenOut: Address,
  fee: V3Fee,
): Promise<V3Quote | undefined> {
  try {
    const { result } = await client.simulateContract({
      address: book.bdexV3QuoterV2,
      abi: bdexV3QuoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    })
    const [amountOut, , , gasEstimate] = result
    return amountOut > 0n ? { version: "V3", fee, amountOut, gasEstimate } : undefined
  } catch {
    return undefined
  }
}

/** Looks up the pools first, then quotes only the ones that exist. */
export async function quoteAll(
  client: PublicClient,
  book: AddressBook,
  amountIn: bigint,
  tokenIn: Address,
  tokenOut: Address,
): Promise<Quote[]> {
  const [pair, pools] = await Promise.all([
    findV2Pair(client, book, tokenIn, tokenOut),
    findV3Pools(client, book, tokenIn, tokenOut),
  ])
  const quotes = await Promise.all([
    pair ? quoteV2(client, book, amountIn, tokenIn, tokenOut) : undefined,
    ...pools.map((p) => quoteV3(client, book, amountIn, tokenIn, tokenOut, p.fee)),
  ])
  return quotes.filter((q): q is Quote => q !== undefined)
}
