// Argument parsing and balance printing for the dex scripts.
import { erc20Abi, formatUnits, parseUnits, type Address, type PublicClient } from "viem"
import { getAddresses } from "@uzolabs/sdk/contracts"
import { parseSlippage } from "../../frontend/src/dex/math.js"
import { getTokens, parseSymbol, SYMBOLS, type Token, type TokenSymbol } from "../../frontend/src/dex/routes.js"
import { fail, type NetworkInfo } from "./network.js"

/** Splits `0.1 BOT USDT --slippage 1 --fee 3000` into positionals and flags. `--mainnet` is a flag with no value. */
export function parseArgs(argv = process.argv.slice(2)) {
  const positionals: string[] = []
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) positionals.push(arg)
    else if (arg === "--mainnet" || arg === "--unwrap") flags.set(arg.slice(2), "true")
    else flags.set(arg.slice(2), argv[++i] ?? "")
  }
  return { positionals, flags }
}

/** Address book and token list for the network the script is talking to. */
export function getDex(net: NetworkInfo) {
  const book = getAddresses(net.chain.id)
  return { book, tokens: getTokens(book) }
}

export function tokenArg(tokens: Record<TokenSymbol, Token>, text: string | undefined, usage: string): Token {
  const symbol = parseSymbol(text)
  if (!symbol) fail(`Unknown token "${text ?? ""}". Use one of ${SYMBOLS.join(", ")}.`, usage)
  return tokens[symbol]
}

export function amountArg(text: string | undefined, token: Token, usage: string): bigint {
  if (!text || !/^\d*\.?\d+$/.test(text)) fail(`"${text ?? ""}" is not an amount.`, usage)
  let amount: bigint
  try {
    amount = parseUnits(text, token.decimals)
  } catch {
    fail(`"${text}" has more decimal places than ${token.symbol} allows (${token.decimals}).`)
  }
  if (amount === 0n) fail("The amount must be more than 0.", usage)
  return amount
}

export function slippageArg(text: string | undefined): number {
  try {
    return parseSlippage(text)
  } catch (error) {
    fail((error as Error).message, "Pass --slippage with a percentage from 0.01 to 5, for example --slippage 0.5")
  }
}

export type Balances = Record<TokenSymbol, bigint>

/** BOT, WBOT and USDT held by `who`. */
export async function readBalances(client: PublicClient, tokens: Record<TokenSymbol, Token>, who: Address) {
  const [bot, wbot, usdt] = await Promise.all([
    client.getBalance({ address: who }),
    client.readContract({ address: tokens.WBOT.address, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    client.readContract({ address: tokens.USDT.address, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
  ])
  return { BOT: bot, WBOT: wbot, USDT: usdt } satisfies Balances
}

/** One line per token. With `before`, each line also shows the change. */
export function printBalances(label: string, tokens: Record<TokenSymbol, Token>, now: Balances, before?: Balances) {
  console.log(`${label}:`)
  for (const symbol of SYMBOLS) {
    const { decimals } = tokens[symbol]
    let line = `  ${symbol.padEnd(5)} ${formatUnits(now[symbol], decimals)}`
    if (before) {
      const delta = now[symbol] - before[symbol]
      if (delta !== 0n) line += `  (${delta > 0n ? "+" : "-"}${formatUnits(delta < 0n ? -delta : delta, decimals)})`
    }
    console.log(line)
  }
}

export const formatToken = (amount: bigint, token: Token) => `${formatUnits(amount, token.decimals)} ${token.symbol}`
