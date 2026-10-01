// Unit tests for the relayer: request checks, rate limits, the HTTP routes and the paymaster adapter.
// They use a fake chain, so they need no node and no key.  npm run test:relayer
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { encodeFunctionData, getAddress, parseAbi, parseEther, type Hex } from "viem"
import { createApp } from "../src/app.js"
import type { RelayChain } from "../src/chain.js"
import { checkRequest, guestBookAbi, RelayError, type ForwardRequestJson } from "../src/forward.js"
import { createPaymaster } from "../src/paymaster.js"
import { RateLimiter } from "../src/rate-limit.js"

const addr = (c: string) => getAddress(`0x${c.repeat(40)}`)
const GUEST_BOOK = addr("b")
const FORWARDER = addr("f")
const RELAYER = addr("e")
const ALICE = addr("a")
const NOW = 1_700_000_000

function request(overrides: Partial<ForwardRequestJson> = {}): ForwardRequestJson {
  return {
    from: ALICE,
    to: GUEST_BOOK,
    value: "0",
    gas: "200000",
    deadline: String(NOW + 600),
    data: encodeFunctionData({ abi: guestBookAbi, functionName: "sign", args: ["hello"] }),
    signature: `0x${"11".repeat(65)}`,
    ...overrides,
  }
}

const policy = { guestBook: GUEST_BOOK, maxGas: 300_000n, now: NOW }

function rejects(body: unknown, status: number, text: RegExp) {
  assert.throws(
    () => checkRequest(body, policy),
    (error: unknown) => error instanceof RelayError && error.status === status && text.test(error.message),
  )
}

describe("checkRequest", () => {
  it("accepts a well formed sign request", () => {
    const parsed = checkRequest({ request: request() }, policy)
    assert.equal(parsed.from, ALICE)
    assert.equal(parsed.gas, 200_000n)
    assert.equal(parsed.deadline, NOW + 600)
  })

  it("rejects a missing or malformed body", () => {
    rejects(null, 400, /request/)
    rejects({ request: { ...request(), gas: 5 } }, 400, /gas must be a string/)
    rejects({ request: request({ from: "alice" }) }, 400, /addresses/)
    rejects({ request: request({ gas: "-1" }) }, 400, /whole numbers/)
    rejects({ request: request({ data: "nothex" }) }, 400, /hex/)
    rejects({ request: request({ signature: "0x1234" }) }, 400, /65 bytes/)
    rejects({ request: request({ data: `0x${"00".repeat(2000)}` }) }, 400, /too long/)
  })

  it("only pays for the guest book (target allowlist)", () => {
    rejects({ request: request({ to: addr("c") }) }, 403, /guest book/)
  })

  it("only pays for sign (selector allowlist)", () => {
    const other = encodeFunctionData({
      abi: parseAbi(["function transfer(address to, uint256 amount)"]),
      args: [ALICE, 1n],
    })
    rejects({ request: request({ data: other }) }, 403, /GuestBook.sign/)
  })

  it("refuses value, too much gas and expired deadlines", () => {
    rejects({ request: request({ value: "1" }) }, 400, /value must be 0/)
    rejects({ request: request({ gas: "300001" }) }, 400, /gas must be between/)
    rejects({ request: request({ gas: "0" }) }, 400, /gas must be between/)
    rejects({ request: request({ deadline: String(NOW - 1) }) }, 400, /expired/)
  })

  it("checks the message length before spending gas", () => {
    const sign = (message: string) => encodeFunctionData({ abi: guestBookAbi, functionName: "sign", args: [message] })
    rejects({ request: request({ data: sign("") }) }, 400, /empty/)
    rejects({ request: request({ data: sign("x".repeat(281)) }) }, 400, /281 bytes/)
    assert.ok(checkRequest({ request: request({ data: sign("x".repeat(280)) }) }, policy))
    rejects({ request: request({ data: `${sign("hi").slice(0, 10)}00` as Hex }) }, 400, /not a valid/)
  })
})

describe("RateLimiter", () => {
  it("allows the limit, then blocks until the window passes", () => {
    let time = 0
    const limiter = new RateLimiter(2, 60_000, () => time)
    limiter.hit("a")
    limiter.hit("a")
    assert.equal(limiter.retryAfter("a"), 60)
    assert.equal(limiter.retryAfter("b"), 0)
    time = 30_000
    assert.equal(limiter.retryAfter("a"), 30)
    time = 60_001
    assert.equal(limiter.retryAfter("a"), 0)
  })
})

/** A chain double that records what the routes asked it to do. */
function fakeChain(overrides: Partial<RelayChain> = {}) {
  const sent: string[] = []
  const chain: RelayChain = {
    relayer: RELAYER,
    forwarder: FORWARDER,
    chainId: 31337,
    paymaster: false,
    verify: async () => true,
    simulate: async () => undefined,
    send: async (r) => {
      sent.push(r.from)
      return { hash: `0x${"ab".repeat(32)}`, paidBy: "relayer" }
    },
    waitForReceipt: async () => "success",
    getBalance: async () => parseEther("5"),
    ...overrides,
  }
  return { chain, sent }
}

function makeApp(chain: RelayChain, ip = () => "1.2.3.4") {
  const warnings: string[] = []
  const { app } = createApp({
    chain,
    guestBook: GUEST_BOOK,
    maxGas: 300_000n,
    rateLimit: 2,
    rateWindowMs: 3_600_000,
    lowBalance: parseEther("1"),
    allowedOrigins: [],
    txUrl: (hash) => `https://explorer.test/tx/${hash}`,
    getIp: ip,
    now: () => NOW * 1000,
    log: { log: () => undefined, warn: (m: string) => warnings.push(m) },
  })
  return { app, warnings }
}

const post = (app: ReturnType<typeof makeApp>["app"], body: unknown) =>
  app.request("/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

describe("POST /relay", () => {
  it("relays a valid request and returns the transaction", async () => {
    const { chain, sent } = fakeChain()
    const { app } = makeApp(chain)
    const response = await post(app, { request: request() })
    assert.equal(response.status, 200)
    const body = (await response.json()) as Record<string, string>
    assert.equal(body.status, "success")
    assert.equal(body.paidBy, "relayer")
    assert.match(body.txUrl!, /\/tx\/0xabab/)
    assert.deepEqual(sent, [ALICE])
  })

  it("does not send when the forwarder's verify fails", async () => {
    const { chain, sent } = fakeChain({ verify: async () => false })
    const response = await post(makeApp(chain).app, { request: request() })
    assert.equal(response.status, 400)
    assert.match(((await response.json()) as { error: string }).error, /rejected the signature/)
    assert.equal(sent.length, 0)
  })

  it("does not send when the dry run reverts", async () => {
    const { chain, sent } = fakeChain({
      simulate: async () => {
        throw new Error("The guest book refused the message.")
      },
    })
    const response = await post(makeApp(chain).app, { request: request() })
    assert.equal(response.status, 400)
    assert.match(((await response.json()) as { error: string }).error, /refused/)
    assert.equal(sent.length, 0)
  })

  it("rate limits per signer", async () => {
    const { chain } = fakeChain()
    let ip = 0
    const { app } = makeApp(chain, () => `10.0.0.${ip++}`)
    assert.equal((await post(app, { request: request() })).status, 200)
    assert.equal((await post(app, { request: request() })).status, 200)
    const third = await post(app, { request: request() })
    assert.equal(third.status, 429)
    assert.ok(Number(third.headers.get("retry-after")) > 0)
    assert.equal((await post(app, { request: request({ from: addr("d") }) })).status, 200)
  })

  it("rate limits per IP address", async () => {
    const { chain } = fakeChain()
    const { app } = makeApp(chain)
    assert.equal((await post(app, { request: request({ from: addr("1") }) })).status, 200)
    assert.equal((await post(app, { request: request({ from: addr("2") }) })).status, 200)
    assert.equal((await post(app, { request: request({ from: addr("3") }) })).status, 429)
  })

  it("answers 400 for a body that is not JSON", async () => {
    const { chain } = fakeChain()
    const response = await makeApp(chain).app.request("/relay", { method: "POST", body: "{" })
    assert.equal(response.status, 400)
  })

  it("answers 502 without details when sending fails", async () => {
    const { chain } = fakeChain({
      send: async () => {
        throw new Error("insufficient funds for gas")
      },
    })
    const { app, warnings } = makeApp(chain)
    const response = await post(app, { request: request() })
    assert.equal(response.status, 502)
    assert.match(warnings[0]!, /insufficient funds/)
  })

  it("answers 202 when the receipt is not in yet", async () => {
    const { chain } = fakeChain({ waitForReceipt: async () => "pending" })
    assert.equal((await post(makeApp(chain).app, { request: request() })).status, 202)
  })

  it("warns when the relayer balance is low", async () => {
    const { chain } = fakeChain({ getBalance: async () => parseEther("0.5") })
    const { app, warnings } = makeApp(chain)
    await post(app, { request: request() })
    await new Promise((resolve) => setImmediate(resolve))
    assert.match(warnings.join("\n"), /below 1/)
  })
})

describe("GET /health", () => {
  it("returns the relayer address and balance", async () => {
    const { chain } = fakeChain({ getBalance: async () => parseEther("0.25") })
    const response = await makeApp(chain).app.request("/health")
    const body = (await response.json()) as Record<string, unknown>
    assert.equal(body.relayer, RELAYER)
    assert.equal(body.balance, "0.25")
    assert.equal(body.lowBalance, true)
    assert.equal(body.paymaster, false)
  })
})

describe("paymaster adapter", () => {
  const tx = { from: RELAYER, to: FORWARDER, data: "0x1234" as Hex, value: 0n, gas: 100_000n }

  function fakeFetch(result: unknown, calls: unknown[] = []): typeof fetch {
    return (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...(result as object) }))
    }) as unknown as typeof fetch
  }

  it("asks pm_isSponsorable with hex quantities", async () => {
    const calls: any[] = []
    const paymaster = createPaymaster("https://paymaster.test", fakeFetch({ result: { sponsorable: true } }, calls))
    assert.equal(await paymaster.isSponsorable(tx), true)
    assert.equal(calls[0].method, "pm_isSponsorable")
    assert.equal(calls[0].params[0].gas, "0x186a0")
  })

  it("treats a no or an error as not sponsorable", async () => {
    assert.equal(
      await createPaymaster("https://p.test", fakeFetch({ result: { sponsorable: false } })).isSponsorable(tx),
      false,
    )
    await assert.rejects(
      createPaymaster("https://p.test", fakeFetch({ error: { message: "policy" } })).isSponsorable(tx),
      /policy/,
    )
  })

  it("sends the raw transaction to the paymaster", async () => {
    const calls: any[] = []
    const hash = `0x${"cd".repeat(32)}`
    const paymaster = createPaymaster("https://p.test", fakeFetch({ result: hash }, calls))
    assert.equal(await paymaster.sendRawTransaction("0xf86c"), hash)
    assert.equal(calls[0].method, "eth_sendRawTransaction")
  })
})
