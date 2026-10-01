// The relayer's HTTP routes. server.ts wires them to a real chain; the tests use a fake one.
import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import { formatEther, type Address, type Hex } from "viem"
import type { RelayChain } from "./chain.js"
import { checkRequest, RelayError } from "./forward.js"
import { RateLimiter } from "./rate-limit.js"

export interface AppOptions {
  chain: RelayChain
  guestBook: Address
  maxGas: bigint
  /** Requests allowed per signer and per IP address in each window. */
  rateLimit: number
  rateWindowMs: number
  /** Warn when the relayer balance drops below this, in wei. */
  lowBalance: bigint
  /** Origins the browser may call from. Empty allows any. */
  allowedOrigins: string[]
  txUrl: (hash: Hex) => string
  getIp: (c: Context) => string
  now?: () => number
  log?: Pick<Console, "log" | "warn">
}

export function createApp(options: AppOptions) {
  const { chain, guestBook, maxGas, lowBalance, txUrl, getIp, now = Date.now, log = console } = options
  const bySigner = new RateLimiter(options.rateLimit, options.rateWindowMs, now)
  const byIp = new RateLimiter(options.rateLimit, options.rateWindowMs, now)

  async function checkBalance(): Promise<bigint> {
    const balance = await chain.getBalance()
    if (balance < lowBalance)
      log.warn(
        `Relayer ${chain.relayer} has ${formatEther(balance)} BOT, below ${formatEther(lowBalance)}. Top it up from the faucet.`,
      )
    return balance
  }

  const app = new Hono()
  app.use("*", cors({ origin: options.allowedOrigins.length > 0 ? options.allowedOrigins : "*" }))

  app.get("/health", async (c) => {
    const balance = await chain.getBalance()
    return c.json({
      ok: true,
      relayer: chain.relayer,
      balance: formatEther(balance),
      lowBalance: balance < lowBalance,
      chainId: chain.chainId,
      forwarder: chain.forwarder,
      guestBook,
      paymaster: chain.paymaster,
    })
  })

  app.post("/relay", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      throw new RelayError(400, "The body must be JSON.")
    }
    const request = checkRequest(body, { guestBook, maxGas, now: Math.floor(now() / 1000) })

    const ipKey = getIp(c)
    const wait = Math.max(bySigner.retryAfter(request.from), byIp.retryAfter(ipKey))
    if (wait > 0) {
      c.header("Retry-After", String(wait))
      throw new RelayError(429, `Too many requests. Try again in ${Math.ceil(wait / 60)} minute(s).`)
    }
    bySigner.hit(request.from)
    byIp.hit(ipKey)

    if (!(await chain.verify(request)))
      throw new RelayError(400, "The forwarder rejected the signature. It may be for an old nonce. Sign again.")
    try {
      await chain.simulate(request)
    } catch (error) {
      throw new RelayError(400, (error as Error).message)
    }

    const { hash, paidBy } = await chain.send(request)
    log.log(`Relayed for ${request.from}: ${txUrl(hash)} (gas paid by ${paidBy})`)
    const status = await chain.waitForReceipt(hash)
    checkBalance().catch(() => undefined)
    return c.json(
      { txHash: hash, txUrl: txUrl(hash), status, paidBy, relayer: chain.relayer },
      status === "pending" ? 202 : 200,
    )
  })

  app.onError((error, c) => {
    if (error instanceof RelayError) return c.json({ error: error.message }, error.status)
    log.warn(`Relay failed: ${error instanceof Error ? error.message : String(error)}`)
    return c.json({ error: "The relayer could not send the transaction. Try again in a minute." }, 502)
  })

  return { app, checkBalance }
}
