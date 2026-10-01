import { useQuery } from "@tanstack/react-query"
import { getAddresses } from "@uzolabs/sdk/contracts"
import { useEffect, useState } from "react"
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem"
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi"
import { ConnectButton } from "./components/ConnectButton"
import { TxStatus } from "./components/TxStatus"
import { DEFAULT_SLIPPAGE_BPS, minAmountOut, parseSlippage, pickBest } from "./dex/math"
import {
  getTokens,
  quoteAll,
  routeLabel,
  SYMBOLS,
  tradeKind,
  type DexChainId,
  type Quote,
  type Token,
  type TokenSymbol,
} from "./dex/routes"
import { buildApprove, buildSwap, buildWrap, spenderFor, type TxRequest } from "./dex/swap"
import { SwapResult, type Outcome, type Sent } from "./SwapResult"
import { addressLink, targetChain } from "./wagmi"

// Every address (WBOT, USDT, routers, quoter, factories) comes from the SDK for the chain the app targets.
const book = getAddresses(targetChain.id as DexChainId)
const tokens = getTokens(book)

/** Wait this long after the last keystroke before asking for quotes. */
const DEBOUNCE_MS = 400
/** Prices move, so quotes refresh on a timer while the form is open. */
const QUOTE_REFRESH_MS = 15_000
const SLIPPAGE_PRESETS = ["0.1", "0.5", "1"]

export function App() {
  return (
    <div className="page">
      <div className="topbar">
        <span className="badge">{targetChain.name}</span>
        <ConnectButton />
      </div>
      <main className="stack">
        <header className="hero">
          <p className="eyebrow">BDEX on {targetChain.name}</p>
          <h1>Swap BOT, WBOT and USDT</h1>
          <p className="lede">
            Quotes come from the BDEX V2 pair and every V3 pool at once, and the best one is used. No contracts of your
            own needed.
          </p>
        </header>
        <SwapCard />
      </main>
      <footer className="footer">
        <p>Learning template. Not audited. Use test funds only.</p>
        <p>Uzo Labs is an independent project and is not affiliated with or endorsed by BOT Chain.</p>
      </footer>
    </div>
  )
}

/** Turns what the user typed into base units, or undefined while it is blank or not a positive number. */
function parseAmount(text: string, token: Token): bigint | undefined {
  if (!/^\d*\.?\d*$/.test(text.trim())) return undefined
  try {
    const amount = parseUnits(text.trim(), token.decimals)
    return amount > 0n ? amount : undefined
  } catch {
    return undefined
  }
}

/** Cuts a decimal string to a few places for display. It rounds down, so a shown minimum is never overstated. */
function trimDecimals(text: string, places = 6) {
  const [whole, fraction = ""] = text.split(".")
  const kept = fraction.slice(0, places).replace(/0+$/, "")
  return kept ? `${whole}.${kept}` : whole!
}

const format = (amount: bigint | undefined, token: Token) =>
  amount === undefined ? "..." : `${trimDecimals(formatUnits(amount, token.decimals))} ${token.symbol}`

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

function SwapCard() {
  const { address: account, chainId } = useAccount()
  const onRightChain = !!account && chainId === targetChain.id
  const [fromSymbol, setFrom] = useState<TokenSymbol>("BOT")
  const [toSymbol, setTo] = useState<TokenSymbol>("USDT")
  const [amountText, setAmountText] = useState("")
  const [slippageText, setSlippageText] = useState(String(DEFAULT_SLIPPAGE_BPS / 100))
  const from = tokens[fromSymbol]
  const to = tokens[toSymbol]
  const kind = tradeKind(fromSymbol, toSymbol)

  const debouncedText = useDebounced(amountText, DEBOUNCE_MS)
  const typing = debouncedText !== amountText
  const amountIn = parseAmount(debouncedText, from)
  const badAmount = amountText.trim() !== "" && parseAmount(amountText, from) === undefined

  let slippageBps: number | undefined
  let slippageError: string | undefined
  try {
    slippageBps = parseSlippage(slippageText)
  } catch (e) {
    slippageError = (e as Error).message
  }

  // Quotes are plain contract reads (getPair, getPool, getAmountsOut, QuoterV2 simulation), polled on a timer.
  const publicClient = usePublicClient({ chainId: targetChain.id })
  const quotes = useQuery({
    queryKey: ["quotes", fromSymbol, toSymbol, amountIn?.toString()],
    queryFn: () => quoteAll(publicClient!, book, amountIn!, from.address, to.address),
    enabled: kind === "swap" && amountIn !== undefined && !!publicClient,
    refetchInterval: QUOTE_REFRESH_MS,
  })
  const best = pickBest(quotes.data ?? [])
  const amountOut = kind === "wrap" || kind === "unwrap" ? amountIn : best?.amountOut

  const balances = useBalances(account)
  const balanceIn = balances.of(from)
  const short = amountIn !== undefined && balanceIn !== undefined && balanceIn < amountIn

  // Only ERC-20 input on a pool swap needs an allowance. BOT is sent as value, and wrapping needs none.
  const spender = kind === "swap" && best ? spenderFor(book, best) : undefined
  const allowance = useReadContract({
    address: from.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && spender ? [account, spender] : undefined,
    chainId: targetChain.id,
    query: { enabled: !!account && !!spender && !from.isNative },
  })
  const needsApproval =
    !!spender && !from.isNative && amountIn !== undefined && (allowance.data === undefined || allowance.data < amountIn)

  const { sendTransaction, data: hash, isPending, error, reset } = useSendTransaction()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: targetChain.id })
  const busy = isPending || receipt.isLoading
  const receiptError = receipt.data?.status === "reverted" ? new Error("The transaction reverted.") : receipt.error

  // The result window opens once per outcome (sent, confirmed, reverted, failed) and stays shut once closed.
  const [sent, setSent] = useState<Sent>()
  const [closedFor, setClosedFor] = useState<string>()
  const outcome: Outcome | undefined = error
    ? { kind: "failed", error }
    : receipt.data
      ? { kind: "success", receipt: receipt.data }
      : receipt.error
        ? { kind: "sentThenError", error: receipt.error }
        : undefined
  const outcomeKey = outcome ? `${hash ?? "unsent"}:${outcome.kind}` : undefined
  const showResult = !!sent && !!outcome && closedFor !== outcomeKey

  useEffect(() => {
    if (!receipt.isSuccess) return
    balances.refetch()
    allowance.refetch()
    quotes.refetch()
  }, [receipt.isSuccess])

  // A finished transaction's status stays until the form changes, then clears for the next one.
  const clearStatus = () => {
    if (!busy) reset()
  }
  function pickFrom(symbol: TokenSymbol) {
    clearStatus()
    if (symbol === toSymbol) setTo(fromSymbol)
    setFrom(symbol)
  }
  function pickTo(symbol: TokenSymbol) {
    clearStatus()
    if (symbol === fromSymbol) setFrom(toSymbol)
    setTo(symbol)
  }
  function flip() {
    clearStatus()
    setFrom(toSymbol)
    setTo(fromSymbol)
  }

  function submit() {
    if (!account || amountIn === undefined) return
    let request: TxRequest
    if (kind === "wrap" || kind === "unwrap") {
      request = buildWrap(book, kind === "unwrap", amountIn)
    } else if (best && spender && needsApproval) {
      // Approve exactly this amount, not an unlimited allowance.
      request = buildApprove(from, spender, amountIn)
    } else if (best && slippageBps !== undefined) {
      request = buildSwap({ book, from, to, amountIn, quote: best, slippageBps, recipient: account, nowMs: Date.now() })
    } else {
      return
    }
    const action = kind === "wrap" || kind === "unwrap" ? kind : needsApproval ? "approve" : "swap"
    setSent({
      action,
      account,
      from,
      to,
      amountIn,
      quoted: action === "swap" ? best?.amountOut : undefined,
      route: action === "swap" && best ? routeLabel(best) : undefined,
      request,
    })
    setClosedFor(undefined)
    reset()
    sendTransaction({ ...request, chainId: targetChain.id })
  }

  const noRoute = kind === "swap" && amountIn !== undefined && quotes.isSuccess && !best
  const quoting = kind === "swap" && (typing || quotes.isFetching) && !best
  const verb = kind === "wrap" ? "Wrap" : kind === "unwrap" ? "Unwrap" : "Swap"
  let label = verb
  if (!account) label = "Connect your wallet"
  else if (!onRightChain) label = `Switch to ${targetChain.name}`
  else if (amountIn === undefined) label = "Enter an amount"
  else if (short) label = `Not enough ${from.symbol}`
  else if (noRoute) label = "No pool can fill this"
  else if (quoting) label = "Getting quotes..."
  else if (needsApproval) label = `Approve ${from.symbol}`
  if (busy) label = "Working..."
  const ready =
    onRightChain &&
    amountIn !== undefined &&
    !typing &&
    !short &&
    !busy &&
    (kind === "wrap" || kind === "unwrap" || (!!best && slippageBps !== undefined && !quotes.isFetching))

  return (
    <section className="card" aria-labelledby="swap-title">
      <div className="row">
        <h2 id="swap-title">{verb}</h2>
        {kind === "swap" && best ? <span className="badge">Best: {routeLabel(best)}</span> : null}
      </div>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="swap-side">
          <label htmlFor="amount-in">You pay</label>
          <div className="swap-input">
            <input
              id="amount-in"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={amountText}
              onChange={(e) => {
                clearStatus()
                setAmountText(e.target.value)
              }}
              aria-invalid={badAmount}
            />
            <TokenSelect id="token-in" label="Token you pay" value={fromSymbol} onChange={pickFrom} />
          </div>
          <p className="muted small">
            Balance: <span className="mono">{account ? format(balanceIn, from) : "connect to see"}</span>
          </p>
          {badAmount ? <p className="error small">Type a number like 0.5.</p> : null}
        </div>

        <button type="button" className="secondary flip" onClick={flip} aria-label="Swap the two tokens">
          ↓↑
        </button>

        <div className="swap-side">
          <label htmlFor="amount-out">You get about</label>
          <div className="swap-input">
            <output id="amount-out" className="swap-out mono">
              {amountOut === undefined
                ? quoting
                  ? "..."
                  : "0.0"
                : trimDecimals(formatUnits(amountOut, to.decimals), 8)}
            </output>
            <TokenSelect id="token-out" label="Token you get" value={toSymbol} onChange={pickTo} />
          </div>
          <p className="muted small">
            Balance: <span className="mono">{account ? format(balances.of(to), to) : "connect to see"}</span>
          </p>
        </div>

        {kind === "swap" ? (
          <Routes quotes={quotes.data} best={best} to={to} slippageBps={slippageBps} />
        ) : (
          <p className="muted small">
            {from.symbol} and {to.symbol} are always 1:1. This calls WBOT's {kind === "wrap" ? "deposit" : "withdraw"}{" "}
            directly, with no pool and no fee.
          </p>
        )}

        {kind === "swap" ? <Slippage text={slippageText} onChange={setSlippageText} error={slippageError} /> : null}

        <button type="submit" disabled={!ready}>
          {label}
        </button>
      </form>

      {needsApproval && ready ? (
        <p className="muted small">
          First you let the {best?.version === "V2" ? "V2 Router02" : "V3 SwapRouter"} spend exactly{" "}
          {format(amountIn, from)}. Then the button changes to Swap.
        </p>
      ) : null}
      <TxStatus
        hash={hash}
        isSigning={isPending}
        isConfirming={receipt.isLoading}
        isSuccess={receipt.isSuccess && receipt.data?.status === "success"}
        error={error ?? receiptError}
      />
      {showResult ? (
        <SwapResult sent={sent} outcome={outcome} hash={hash} onClose={() => setClosedFor(outcomeKey)} />
      ) : null}
    </section>
  )
}

function TokenSelect(props: { id: string; label: string; value: TokenSymbol; onChange: (s: TokenSymbol) => void }) {
  return (
    <select
      id={props.id}
      className="token-select"
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as TokenSymbol)}
    >
      {SYMBOLS.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

function Routes({
  quotes,
  best,
  to,
  slippageBps,
}: {
  quotes?: Quote[]
  best?: Quote
  to: Token
  slippageBps?: number
}) {
  if (!quotes || quotes.length === 0 || !best) return null
  return (
    <div className="routes">
      <ul>
        {quotes.map((q) => (
          <li key={routeLabel(q)} className={q === best ? "best" : undefined}>
            <span>{routeLabel(q)}</span>
            <span className="mono">{format(q.amountOut, to)}</span>
          </li>
        ))}
      </ul>
      {slippageBps !== undefined ? (
        <p className="muted small">
          You get at least <span className="mono">{format(minAmountOut(best.amountOut, slippageBps), to)}</span> or the
          swap reverts.{" "}
          <a href={addressLink(spenderFor(book, best))} target="_blank" rel="noreferrer">
            Router on BOTScan
          </a>
        </p>
      ) : null}
    </div>
  )
}

function Slippage({ text, onChange, error }: { text: string; onChange: (t: string) => void; error?: string }) {
  return (
    <fieldset className="slippage">
      <legend>Slippage tolerance (%)</legend>
      <div className="slippage-row">
        {SLIPPAGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={text === p ? undefined : "secondary"}
            aria-pressed={text === p}
            onClick={() => onChange(p)}
          >
            {p}%
          </button>
        ))}
        <input
          aria-label="Custom slippage in percent"
          inputMode="decimal"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
        />
      </div>
      {error ? <p className="error small">{error}</p> : null}
    </fieldset>
  )
}

/** BOT from the chain itself, WBOT and USDT from balanceOf. Polled, no event subscriptions. */
function useBalances(account: Address | undefined) {
  const native = useBalance({ address: account, chainId: targetChain.id, query: { refetchInterval: 15_000 } })
  const erc20 = useReadContracts({
    contracts: [tokens.WBOT, tokens.USDT].map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [account!] as const,
      chainId: targetChain.id,
    })),
    allowFailure: false,
    query: { enabled: !!account, refetchInterval: 15_000 },
  })
  const [wbot, usdt] = erc20.data ?? []
  return {
    of: (token: Token) => (token.symbol === "BOT" ? native.data?.value : token.symbol === "WBOT" ? wbot : usdt),
    refetch: () => {
      native.refetch()
      erc20.refetch()
    },
  }
}
