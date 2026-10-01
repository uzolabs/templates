// Turns a failed wrap, approve or swap into a plain reason and a fix. Shared by the web app and the unit tests.

export type Failure = {
  /** What went wrong, in one sentence. */
  reason: string
  /** What to do about it. */
  fix: string
}

export type FailureContext = {
  /** Symbol of the token being paid, such as USDT. */
  from: string
  /** Symbol of the chain's gas token, such as BOT. */
  native: string
  /** Where to get free test gas, shown only on testnet. */
  faucetUrl?: string
}

/** Every message, reason and error name in an error and the errors that caused it, one per line. */
function textOf(error: unknown): string {
  const parts: string[] = []
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 10; depth++) {
    const e = current as Record<string, unknown>
    for (const key of ["shortMessage", "message", "details", "reason"]) {
      if (typeof e[key] === "string") parts.push(e[key] as string)
    }
    const data = e.data as { errorName?: unknown } | undefined
    if (data && typeof data.errorName === "string") parts.push(data.errorName)
    current = e.cause
  }
  return parts.join("\n")
}

function hasCode(error: unknown, code: number): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 10; depth++) {
    if ((current as { code?: unknown }).code === code) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Matches the error against what the wallet, the RPC, WBOT and the BDEX routers say when they refuse.
 * V2 says things like "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT" and "EXPIRED"; V3 says "Too little received",
 * "Transaction too old" and "STF" (its token transfer failed).
 */
export function explainFailure(error: unknown, ctx: FailureContext): Failure {
  const original = textOf(error)
  const text = original.toLowerCase()
  const has = (...needles: string[]) => needles.some((n) => text.includes(n))

  if (hasCode(error, 4001) || has("user rejected", "user denied", "rejected the request", "user cancelled")) {
    return {
      reason: "You cancelled it in your wallet.",
      fix: "Press the button again when you are ready.",
    }
  }
  if (has("insufficient funds")) {
    return {
      reason: `Your wallet does not have enough ${ctx.native} to cover the amount plus the gas fee.`,
      fix:
        `Try a smaller amount and leave a little ${ctx.native} for gas.` +
        (ctx.faucetUrl ? ` Free test ${ctx.native} is at ${ctx.faucetUrl}` : ""),
    }
  }
  if (has("insufficient_output_amount", "too little received")) {
    return {
      reason: "The price moved past your slippage tolerance before the swap went through, so the router refused it.",
      fix: "Try again with a fresh quote, or raise the slippage tolerance a little, or swap a smaller amount.",
    }
  }
  if (has("expired", "transaction too old")) {
    return {
      reason: "The swap waited too long to be included and passed its deadline.",
      fix: "Try again. If your wallet lets you set gas, use the suggested fee so it is picked up quickly.",
    }
  }
  if (has("exceeds allowance", "insufficient allowance")) {
    return {
      reason: `The router is not allowed to spend that much of your ${ctx.from}.`,
      fix: `Approve ${ctx.from} again for this amount, then swap.`,
    }
  }
  if (has("exceeds balance", "insufficient balance", "transfer_from_failed") || /\bstf\b/.test(text)) {
    return {
      reason: `Your wallet did not have enough ${ctx.from} when the transaction ran, or the router was not approved for it.`,
      fix: `Check your ${ctx.from} balance and approval, then try a smaller amount.`,
    }
  }
  if (has("insufficient_liquidity", "insufficient_input_amount")) {
    return {
      reason: "The pool does not hold enough tokens to fill this trade.",
      fix: "Try a smaller amount.",
    }
  }
  if (has("http request failed", "failed to fetch", "fetch failed", "timed out", "took too long")) {
    return {
      reason: "The network RPC did not answer. Public RPCs sometimes go down for a minute.",
      fix: "Wait a minute and try again. Check BOTScan first if your wallet says it was sent.",
    }
  }
  if (has("reverted", "execution reverted")) {
    return {
      reason: "The contract refused the transaction.",
      fix: "Refresh the quote and try again, or try a smaller amount.",
    }
  }
  const first = original.split("\n")[0]
  return {
    reason: first ? `Your wallet or the network said: ${first}` : "Something went wrong.",
    fix: "Try again. If it keeps happening, check your wallet's activity tab and BOTScan for details.",
  }
}
