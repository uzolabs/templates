// Unit tests for the failure reasons shown in the web app's result window. Run with: npm test
import assert from "node:assert/strict"
import { test } from "node:test"
import { explainFailure } from "../../frontend/src/dex/errors.js"

const ctx = { from: "USDT", native: "BOT", faucetUrl: "https://faucet.example" }

/** An error shaped like viem's: a short message on top, the wallet or node error underneath. */
function wrapped(inner: Record<string, unknown>) {
  return Object.assign(new Error("Transaction failed."), { shortMessage: "Transaction failed.", cause: inner })
}

test("a rejection in the wallet (code 4001) says you cancelled", () => {
  const failure = explainFailure(wrapped({ code: 4001, message: "MetaMask Tx Signature: User denied." }), ctx)
  assert.match(failure.reason, /cancelled/)
})

test("not enough gas money names the gas token and the faucet", () => {
  const failure = explainFailure(wrapped({ message: "insufficient funds for gas * price + value" }), ctx)
  assert.match(failure.reason, /enough BOT/)
  assert.match(failure.fix, /faucet\.example/)
  assert.doesNotMatch(explainFailure(new Error("insufficient funds"), { ...ctx, faucetUrl: undefined }).fix, /faucet/)
})

test("V2 and V3 slippage reverts are explained as slippage", () => {
  for (const reason of ["UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT", "Too little received"]) {
    assert.match(explainFailure(wrapped({ reason }), ctx).reason, /slippage/)
  }
})

test("V2 and V3 deadline reverts are explained as an expired deadline", () => {
  for (const reason of ["UniswapV2Router: EXPIRED", "Transaction too old"]) {
    assert.match(explainFailure(wrapped({ reason }), ctx).reason, /deadline/)
  }
})

test("token transfer failures name the token being paid", () => {
  for (const reason of ["ERC20: transfer amount exceeds balance", "STF", "TransferHelper: TRANSFER_FROM_FAILED"]) {
    assert.match(explainFailure(wrapped({ reason }), ctx).reason, /enough USDT/)
  }
  assert.match(explainFailure(wrapped({ reason: "ERC20: insufficient allowance" }), ctx).fix, /Approve USDT/)
})

test("STF only matches as a whole word", () => {
  assert.doesNotMatch(explainFailure(new Error("lastfetch broke"), ctx).reason, /enough USDT/)
})

test("an RPC outage is not blamed on the user", () => {
  assert.match(explainFailure(wrapped({ message: "HTTP request failed. Status: 503" }), ctx).reason, /RPC/)
})

test("anything else falls back to the first line of what the wallet said", () => {
  assert.match(explainFailure(new Error("Something odd\nstack"), ctx).reason, /said: Something odd$/)
})
