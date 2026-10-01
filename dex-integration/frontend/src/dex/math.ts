// Pure helpers for slippage, deadlines and picking the best quote. No network calls, so they are unit tested
// (scripts/lib/math.test.ts) and shared by the scripts and the web app.

/** 0.5%, written in basis points (1 bp = 0.01%). */
export const DEFAULT_SLIPPAGE_BPS = 50
/** Anything above 5% is almost always a mistake, so it is refused. */
export const MAX_SLIPPAGE_BPS = 500
/** A swap that waits longer than this reverts instead of filling at a stale price. */
export const DEADLINE_MINUTES = 20
/** The V3 fee tiers BDEX can have pools for, in hundredths of a basis point (3000 = 0.3%). */
export const V3_FEES = [100, 500, 3000, 10000] as const
export type V3Fee = (typeof V3_FEES)[number]

/**
 * Turns a slippage percentage typed by a person ("0.5", "1", "0.25%") into basis points.
 * Blank means the default. Throws a readable error for anything that is not a number from 0.01 to 5.
 */
export function parseSlippage(text?: string): number {
  const cleaned = (text ?? "").trim().replace(/%$/, "")
  if (cleaned === "") return DEFAULT_SLIPPAGE_BPS
  if (!/^\d*\.?\d+$/.test(cleaned)) throw new Error(`Slippage must be a percentage such as 0.5, not "${text}".`)
  const bps = Math.round(Number(cleaned) * 100)
  if (bps < 1) throw new Error("Slippage must be at least 0.01%.")
  if (bps > MAX_SLIPPAGE_BPS) throw new Error(`Slippage above ${MAX_SLIPPAGE_BPS / 100}% is refused.`)
  return bps
}

/** The least you accept: the quote minus the slippage, rounded down. */
export function minAmountOut(quoted: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS)
    throw new Error("Slippage out of range.")
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n
}

/** Unix time, in seconds, after which the router rejects the swap. */
export function deadlineFrom(nowMs: number, minutes = DEADLINE_MINUTES): bigint {
  return BigInt(Math.floor(nowMs / 1000) + minutes * 60)
}

/** "0.3%" for 3000. */
export function feeLabel(fee: number): string {
  return `${fee / 10_000}%`
}

/** The quote with the largest output, or undefined when there are none. Ties go to the first one. */
export function pickBest<T extends { amountOut: bigint }>(quotes: readonly T[]): T | undefined {
  let best: T | undefined
  for (const q of quotes) if (best === undefined || q.amountOut > best.amountOut) best = q
  return best
}
