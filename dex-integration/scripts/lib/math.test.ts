// Unit tests for the swap math shared by the scripts and the web app. Run with: npm test
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DEFAULT_SLIPPAGE_BPS,
  deadlineFrom,
  feeLabel,
  minAmountOut,
  parseSlippage,
  pickBest,
} from "../../frontend/src/dex/math.js"
import { parseSymbol, tradeKind } from "../../frontend/src/dex/routes.js"

test("slippage defaults to 0.5% when blank", () => {
  assert.equal(parseSlippage(), DEFAULT_SLIPPAGE_BPS)
  assert.equal(parseSlippage(" "), 50)
})

test("slippage reads percentages as basis points", () => {
  assert.equal(parseSlippage("0.5"), 50)
  assert.equal(parseSlippage("1"), 100)
  assert.equal(parseSlippage("0.25%"), 25)
  assert.equal(parseSlippage(".1"), 10)
  assert.equal(parseSlippage("5"), 500)
})

test("slippage above 5%, below 0.01% or not a number is refused", () => {
  assert.throws(() => parseSlippage("5.01"), /refused/)
  assert.throws(() => parseSlippage("50"), /refused/)
  assert.throws(() => parseSlippage("0.001"), /at least/)
  assert.throws(() => parseSlippage("-1"), /percentage/)
  assert.throws(() => parseSlippage("abc"), /percentage/)
})

test("minimum out is the quote minus slippage, rounded down", () => {
  assert.equal(minAmountOut(1_000_000n, 50), 995_000n)
  assert.equal(minAmountOut(1_000_000n, 0), 1_000_000n)
  assert.equal(minAmountOut(999n, 50), 994n) // 994.005 rounds down
  // USDT has 6 decimals: 16.15 USDT at 0.5% is 16.06925 USDT.
  assert.equal(minAmountOut(16_150_000n, 50), 16_069_250n)
  assert.throws(() => minAmountOut(1n, 501))
  assert.throws(() => minAmountOut(1n, 0.5))
})

test("deadline is 20 minutes after now, in seconds", () => {
  assert.equal(deadlineFrom(1_700_000_000_500), 1_700_000_000n + 1200n)
  assert.equal(deadlineFrom(0, 1), 60n)
})

test("fee tiers print as percentages", () => {
  assert.equal(feeLabel(100), "0.01%")
  assert.equal(feeLabel(500), "0.05%")
  assert.equal(feeLabel(3000), "0.3%")
  assert.equal(feeLabel(10000), "1%")
})

test("the best quote is the one with the most output", () => {
  const v2 = { route: "V2", amountOut: 16_150_000n }
  const v3 = { route: "V3", amountOut: 10_320_000n }
  assert.equal(pickBest([v3, v2]), v2)
  assert.equal(pickBest([]), undefined)
  const tie = { route: "tie", amountOut: v2.amountOut }
  assert.equal(pickBest([v2, tie]), v2)
})

test("BOT and WBOT trades are wraps, not swaps", () => {
  assert.equal(tradeKind("BOT", "WBOT"), "wrap")
  assert.equal(tradeKind("WBOT", "BOT"), "unwrap")
  assert.equal(tradeKind("BOT", "USDT"), "swap")
  assert.equal(tradeKind("USDT", "WBOT"), "swap")
  assert.equal(tradeKind("USDT", "USDT"), "same")
})

test("token symbols are case-insensitive", () => {
  assert.equal(parseSymbol("usdt"), "USDT")
  assert.equal(parseSymbol(" wbot "), "WBOT")
  assert.equal(parseSymbol("ETH"), undefined)
  assert.equal(parseSymbol(undefined), undefined)
})
