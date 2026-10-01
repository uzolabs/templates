// The window that opens when a wrap, approval or swap finishes: what happened, what you got, or why it failed.
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { erc20Abi, formatEther, formatUnits, type Address, type TransactionReceipt } from "viem"
import { usePublicClient } from "wagmi"
import { explainFailure } from "./dex/errors"
import type { Token } from "./dex/routes"
import type { TxRequest } from "./dex/swap"
import { targetChain, txLink } from "./wagmi"

/** What the user asked for, saved when they pressed the button so the window can describe it afterwards. */
export type Sent = {
  action: "approve" | "wrap" | "unwrap" | "swap"
  account: Address
  from: Token
  to: Token
  amountIn: bigint
  /** The quoted output, shown if the real amount cannot be read back. Swaps only. */
  quoted?: bigint
  route?: string
  request: TxRequest
}

export type Outcome =
  | { kind: "success"; receipt: TransactionReceipt }
  /** The wallet refused, or the transaction could not be sent. */
  | { kind: "failed"; error: Error }
  /**
   * It was sent, then waiting for it failed. wagmi throws here both when the transaction reverted (it replays it to
   * find the reason) and when the RPC stopped answering, so the window looks the receipt up again to tell which.
   */
  | { kind: "sentThenError"; error: Error }

/** What the window shows, once a sentThenError has been checked against the chain. */
type View =
  | { kind: "success"; receipt: TransactionReceipt }
  | { kind: "reverted"; receipt: TransactionReceipt; error: Error }
  | { kind: "failed"; error: Error }
  | { kind: "checking" }
  | { kind: "unknown" }

const FAUCET_URL = "https://faucet.botchain.ai/basic"
const isTestnet = targetChain.testnet === true

const amount = (value: bigint, token: Token) => {
  const [whole, fraction = ""] = formatUnits(value, token.decimals).split(".")
  const kept = fraction.slice(0, 6).replace(/0+$/, "")
  return `${kept ? `${whole}.${kept}` : whole} ${token.symbol}`
}

type Props = { sent: Sent; outcome: Outcome; hash?: `0x${string}`; onClose: () => void }

export function SwapResult({ sent, outcome, hash, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  // showModal() gives the focus trap, Escape to close and the backdrop, and makes the rest of the page inert.
  // Closing (Escape or the button) fires the dialog's close event, which tells the parent to remove it.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const client = usePublicClient({ chainId: targetChain.id })
  const lookup = useQuery({
    queryKey: ["receipt", hash],
    enabled: outcome.kind === "sentThenError" && !!hash && !!client,
    retry: 3,
    queryFn: () => client!.getTransactionReceipt({ hash: hash! }),
  })
  const view: View =
    outcome.kind !== "sentThenError"
      ? outcome
      : lookup.isLoading
        ? { kind: "checking" }
        : !lookup.data
          ? { kind: "unknown" }
          : lookup.data.status === "success"
            ? { kind: "success", receipt: lookup.data }
            : { kind: "reverted", receipt: lookup.data, error: outcome.error }

  const ok = view.kind === "success"
  const pending = view.kind === "checking" || view.kind === "unknown"
  const title = ok
    ? sent.action === "approve"
      ? "Approval confirmed"
      : `${verbPast(sent.action)} confirmed`
    : view.kind === "checking"
      ? "Checking what happened..."
      : view.kind === "unknown"
        ? "Sent, but not confirmed yet"
        : `${verbNoun(sent.action)} failed`

  return (
    <dialog
      ref={ref}
      className={`result card ${ok ? "is-success" : pending ? "is-unknown" : "is-error"}`}
      aria-labelledby="result-title"
      aria-describedby="result-body"
      onClose={onClose}
    >
      <div className="result-head">
        <span className="result-icon" aria-hidden="true">
          {ok ? "✓" : pending ? "?" : "!"}
        </span>
        <h2 id="result-title">{title}</h2>
      </div>
      <div id="result-body" className="result-body">
        {view.kind === "success" ? (
          <Success sent={sent} receipt={view.receipt} />
        ) : view.kind === "reverted" ? (
          <Reverted sent={sent} receipt={view.receipt} fallback={view.error} />
        ) : view.kind === "failed" ? (
          <Reason sent={sent} error={view.error} />
        ) : view.kind === "checking" ? (
          <p className="muted">Your wallet sent it. Looking it up on the chain...</p>
        ) : (
          <p>
            Your wallet sent it, but the network RPC stopped answering before it confirmed. It may still go through.
            Check BOTScan before you try again, so you do not swap twice.
          </p>
        )}
      </div>
      <div className="result-actions">
        {hash ? (
          <a href={txLink(hash)} target="_blank" rel="noreferrer">
            View on BOTScan
          </a>
        ) : null}
        <button type="button" onClick={() => ref.current?.close()} autoFocus>
          {ok && sent.action === "approve" ? "Continue to swap" : ok ? "Done" : "Close"}
        </button>
      </div>
    </dialog>
  )
}

const verbPast = (a: Sent["action"]) => (a === "wrap" ? "Wrap" : a === "unwrap" ? "Unwrap" : "Swap")
const verbNoun = (a: Sent["action"]) => (a === "approve" ? "Approval" : verbPast(a))

function Success({ sent, receipt }: { sent: Sent; receipt: TransactionReceipt }) {
  const client = usePublicClient({ chainId: targetChain.id })
  const fee = receipt.gasUsed * receipt.effectiveGasPrice

  // What actually arrived: the balance at the end of the block minus the balance before it. Two plain reads at a
  // block number, no log queries. Gas is added back when the output is the gas token itself.
  const received = useQuery({
    queryKey: ["received", receipt.transactionHash],
    enabled: !!client && sent.action !== "approve",
    retry: 2,
    queryFn: async () => {
      const at = (blockNumber: bigint) =>
        sent.to.isNative
          ? client!.getBalance({ address: sent.account, blockNumber })
          : client!.readContract({
              address: sent.to.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [sent.account],
              blockNumber,
            })
      const [before, after] = await Promise.all([at(receipt.blockNumber - 1n), at(receipt.blockNumber)])
      return after - before + (sent.to.isNative ? fee : 0n)
    },
  })

  if (sent.action === "approve") {
    return (
      <>
        <p>The router may now spend up to {amount(sent.amountIn, sent.from)} of yours. Nothing was swapped yet.</p>
        <p className="muted">Press Swap to finish. It will ask your wallet once more.</p>
        <dl className="result-list">
          <Row label="Gas paid" value={`${trimEther(fee)} ${targetChain.nativeCurrency.symbol}`} />
        </dl>
      </>
    )
  }

  const got =
    received.data !== undefined
      ? amount(received.data, sent.to)
      : received.isLoading
        ? "checking..."
        : sent.quoted !== undefined
          ? `about ${amount(sent.quoted, sent.to)}`
          : "see BOTScan"
  return (
    <dl className="result-list">
      <Row label="You paid" value={amount(sent.amountIn, sent.from)} />
      <Row label="You got" value={got} />
      {sent.route ? <Row label="Route" value={sent.route} /> : null}
      <Row label="Gas paid" value={`${trimEther(fee)} ${targetChain.nativeCurrency.symbol}`} />
    </dl>
  )
}

/**
 * A reverted receipt carries no reason. Replaying the same call on the state just before its block usually gets
 * the router's message back (such as "Too little received"), so the window can say why. If that replay goes
 * through, wagmi's own replay (on the latest state) is used instead.
 */
function Reverted({ sent, receipt, fallback }: { sent: Sent; receipt: TransactionReceipt; fallback: Error }) {
  const client = usePublicClient({ chainId: targetChain.id })
  const replay = useQuery({
    queryKey: ["replay", receipt.transactionHash],
    enabled: !!client,
    retry: 1,
    queryFn: async () => {
      try {
        await client!.call({ account: sent.account, ...sent.request, blockNumber: receipt.blockNumber - 1n })
        return null
      } catch (error) {
        return error as Error
      }
    },
  })
  if (replay.isLoading) return <p className="muted">It reverted on chain. Finding out why...</p>
  const error = replay.data ?? fallback
  return <Reason sent={sent} error={error} spentGas />
}

function Reason({ sent, error, spentGas }: { sent: Sent; error: Error; spentGas?: boolean }) {
  const failure = explainFailure(error, {
    from: sent.from.symbol,
    native: targetChain.nativeCurrency.symbol,
    faucetUrl: isTestnet ? FAUCET_URL : undefined,
  })
  return (
    <>
      <p className="result-reason">{failure.reason}</p>
      <p>{failure.fix}</p>
      <p className="muted small">
        {spentGas
          ? `It reached the chain and was undone, so your ${sent.from.symbol} stayed in your wallet. Only the gas fee was spent.`
          : `Nothing reached the chain, so nothing was spent, not even gas.`}
      </p>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mono">{value}</dd>
    </div>
  )
}

function trimEther(wei: bigint) {
  const [whole, fraction = ""] = formatEther(wei).split(".")
  const kept = fraction.slice(0, 6).replace(/0+$/, "")
  return kept ? `${whole}.${kept}` : whole!
}
