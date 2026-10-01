import { useState, type FormEvent, type ReactNode } from "react"
import { formatEther, isAddress, isAddressEqual, type Address, type Hex } from "viem"
import { useAccount, useBalance, usePublicClient, useReadContract, useSignTypedData } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { guestBookAbi } from "./abi"
import { ConnectButton } from "./components/ConnectButton"
import { readableError } from "./components/TxStatus"
import { buildRequest, forwardRequestTypes, relay, type RelayResult } from "./forward"
import { addressLink, targetChain, txLink } from "./wagmi"

const asAddress = (value?: string) => (value && isAddress(value) ? value : undefined)
const guestBookAddress = asAddress(import.meta.env.VITE_CONTRACT_ADDRESS)
const forwarderAddress = asAddress(import.meta.env.VITE_FORWARDER_ADDRESS)
const relayerUrl = import.meta.env.VITE_RELAYER_URL?.replace(/\/+$/, "")

/** Must match GuestBook.MAX_MESSAGE_LENGTH. It counts bytes, so an emoji uses up to 4. */
const MAX_BYTES = 280
/** The list shows the newest entries only, read with getEntries(offset, limit). */
const PAGE_SIZE = 20
const coin = targetChain.nativeCurrency.symbol
const shorten = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`

export function App() {
  const ready = guestBookAddress && forwarderAddress && relayerUrl
  return (
    <div className="page">
      <div className="topbar">
        <span className="badge">{targetChain.name}</span>
        <ConnectButton />
      </div>
      {ready ? (
        <GuestBookApp guestBook={guestBookAddress} forwarder={forwarderAddress} relayer={relayerUrl} />
      ) : (
        <NotDeployed />
      )}
      <footer className="footer">
        <p>Learning template. Not audited. Use test funds only.</p>
        <p>Uzo Labs is an independent project and is not affiliated with or endorsed by BOT Chain.</p>
      </footer>
    </div>
  )
}

function Hero({ eyebrow, title, lede }: { eyebrow: string; title: ReactNode; lede: ReactNode }) {
  return (
    <header className="hero">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
    </header>
  )
}

function NotDeployed() {
  const missing = [
    guestBookAddress ? null : "VITE_CONTRACT_ADDRESS",
    forwarderAddress ? null : "VITE_FORWARDER_ADDRESS",
    relayerUrl ? null : "VITE_RELAYER_URL",
  ].filter(Boolean)
  return (
    <main className="stack">
      <Hero
        eyebrow="Gasless app template"
        title="Deploy the guest book first"
        lede="This app needs the guest book, its forwarder and a running relayer."
      />
      <section className="card">
        <h2>Missing settings</h2>
        <p>
          <code>frontend/.env</code> has no {missing.join(", ")}. Run <code>npm run deploy</code> in the project folder,
          start <code>npm run relayer</code>, then restart <code>npm run frontend</code>.
        </p>
      </section>
    </main>
  )
}

type Props = { guestBook: Address; forwarder: Address; relayer: string }

function GuestBookApp({ guestBook, forwarder, relayer }: Props) {
  // Polling reads instead of event subscriptions: BOT Chain RPCs do not serve eth_getLogs.
  const count = useReadContract({
    address: guestBook,
    abi: guestBookAbi,
    chainId: targetChain.id,
    functionName: "entryCount",
    query: { refetchInterval: 10_000 },
  })

  return (
    <main className="stack">
      <Hero
        eyebrow={`Gasless on ${targetChain.name}`}
        title="Sign the guest book for free"
        lede={
          <>You sign a message in your wallet. The relayer sends it and pays the gas. Your wallet can hold 0 {coin}.</>
        }
      />
      <SignCard guestBook={guestBook} forwarder={forwarder} relayer={relayer} onSigned={() => count.refetch()} />
      <EntriesCard guestBook={guestBook} count={count.data} />
      <RelayerCard relayer={relayer} />
    </main>
  )
}

type Step =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "signing" }
  | { kind: "relaying" }
  | { kind: "done"; result: RelayResult }
  | { kind: "error"; message: string }

function SignCard({ guestBook, forwarder, relayer, onSigned }: Props & { onSigned: () => void }) {
  const { address: account, chainId } = useAccount()
  const client = usePublicClient({ chainId: targetChain.id })
  const { signTypedDataAsync } = useSignTypedData()
  const { data: balance } = useBalance({
    address: account,
    chainId: targetChain.id,
    query: { refetchInterval: 10_000 },
  })
  const [message, setMessage] = useState("")
  const [step, setStep] = useState<Step>({ kind: "idle" })

  const bytes = new TextEncoder().encode(message.trim()).length
  const tooLong = bytes > MAX_BYTES
  const onRightChain = chainId === targetChain.id
  const busy = step.kind === "preparing" || step.kind === "signing" || step.kind === "relaying"
  const canSign = !!account && onRightChain && !!client && bytes > 0 && !tooLong && !busy

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSign) return
    try {
      setStep({ kind: "preparing" })
      const text = message.trim()
      const { domain, message: request } = await buildRequest(client, {
        from: account,
        guestBook,
        forwarder,
        message: text,
      })
      setStep({ kind: "signing" })
      // Only a signature: no transaction, so the wallet asks for no gas.
      const signature: Hex = await signTypedDataAsync({
        domain,
        types: forwardRequestTypes,
        primaryType: "ForwardRequest",
        message: request,
      })
      setStep({ kind: "relaying" })
      const result = await relay(relayer, request, signature)
      if (result.status === "reverted") throw new Error("The transaction was sent but reverted on chain.")
      setStep({ kind: "done", result })
      setMessage("")
      onSigned()
    } catch (error) {
      setStep({ kind: "error", message: readableError(error as Error) })
    }
  }

  return (
    <section className="card" aria-labelledby="sign-title">
      <div className="row">
        <h2 id="sign-title">Leave a message</h2>
        {balance ? (
          <span className="badge">
            You hold {formatEther(balance.value)} {coin}
          </span>
        ) : null}
      </div>
      <form className="sign-form" onSubmit={submit}>
        <label htmlFor="message">Message</label>
        <input
          id="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="gm from a wallet with no gas"
          autoComplete="off"
          aria-describedby="message-count"
          aria-invalid={tooLong}
        />
        <p id="message-count" className={tooLong ? "error" : "muted"}>
          {bytes} of {MAX_BYTES} bytes
        </p>
        <button type="submit" disabled={!canSign}>
          {step.kind === "preparing"
            ? "Preparing..."
            : step.kind === "signing"
              ? "Sign in your wallet..."
              : step.kind === "relaying"
                ? "Relaying..."
                : "Sign for free"}
        </button>
      </form>
      {!account ? <p className="muted">Connect a wallet to sign. It does not need any {coin}.</p> : null}
      {account && !onRightChain ? <p className="muted">Switch your wallet to {targetChain.name} to sign.</p> : null}
      <div className="status" aria-live="polite">
        <SignStatus step={step} />
      </div>
    </section>
  )
}

function SignStatus({ step }: { step: Step }) {
  switch (step.kind) {
    case "preparing":
      return <p className="muted">Reading your nonce from the forwarder...</p>
    case "signing":
      return <p className="muted">Approve the signature in your wallet. It is not a transaction and costs nothing.</p>
    case "relaying":
      return <p className="muted">The relayer is checking your signature and sending the transaction...</p>
    case "error":
      return <p className="error">{step.message}</p>
    case "done": {
      const { result } = step
      const link = (
        <a href={txLink(result.txHash)} target="_blank" rel="noreferrer">
          View on BOTScan
        </a>
      )
      if (result.status === "pending")
        return <p className="muted">Sent by the relayer. Waiting for it to be included. {link}</p>
      return (
        <p className="success">
          Signed. Gas paid by {result.paidBy === "paymaster" ? "the paymaster" : "relayer"}{" "}
          <span className="mono">{shorten(result.relayer)}</span>. {link}
        </p>
      )
    }
    default:
      return null
  }
}

function EntriesCard({ guestBook, count }: { guestBook: Address; count?: bigint }) {
  const { address: account } = useAccount()
  const offset = count !== undefined && count > BigInt(PAGE_SIZE) ? count - BigInt(PAGE_SIZE) : 0n
  const entries = useReadContract({
    address: guestBook,
    abi: guestBookAbi,
    chainId: targetChain.id,
    functionName: "getEntries",
    args: [offset, BigInt(PAGE_SIZE)],
    // The count in the key refetches the page as soon as a new entry lands.
    scopeKey: String(count),
    query: { enabled: count !== undefined, refetchInterval: 10_000 },
  })
  // getEntries returns oldest first; show the newest at the top.
  const newestFirst = [...(entries.data ?? [])].map((entry, i) => ({ ...entry, id: offset + BigInt(i) })).reverse()

  return (
    <section className="card" aria-labelledby="entries-title">
      <div className="row">
        <h2 id="entries-title">Guest book</h2>
        {count !== undefined ? <span className="badge">{count.toString()} signed</span> : null}
      </div>
      {count === undefined || entries.isLoading ? (
        <p className="muted">Loading...</p>
      ) : newestFirst.length === 0 ? (
        <p className="muted">No one has signed yet. Be the first.</p>
      ) : (
        <ol className="entries">
          {newestFirst.map((entry) => {
            const mine = !!account && isAddressEqual(entry.author, account)
            return (
              <li key={entry.id.toString()} className={mine ? "entry mine" : "entry"}>
                <p className="entry-message">{entry.message}</p>
                <p className="entry-meta muted">
                  <a href={addressLink(entry.author)} target="_blank" rel="noreferrer" className="mono">
                    {shorten(entry.author)}
                  </a>
                  {mine ? " (you)" : ""} &middot; {new Date(Number(entry.timestamp) * 1000).toLocaleString()}
                </p>
              </li>
            )
          })}
        </ol>
      )}
      {count !== undefined && count > BigInt(PAGE_SIZE) ? (
        <p className="muted">Showing the newest {PAGE_SIZE}.</p>
      ) : null}
    </section>
  )
}

type Health = { relayer: Address; balance: string; lowBalance: boolean; paymaster: boolean; chainId: number }

function RelayerCard({ relayer }: { relayer: string }) {
  const health = useQuery({
    queryKey: ["relayer-health", relayer],
    queryFn: async (): Promise<Health> => {
      const response = await fetch(`${relayer}/health`)
      if (!response.ok) throw new Error(`The relayer answered ${response.status}.`)
      return response.json()
    },
    refetchInterval: 30_000,
    retry: false,
  })
  const data = health.data

  return (
    <section className="card" aria-labelledby="relayer-title">
      <div className="row">
        <h2 id="relayer-title">Relayer</h2>
        <span className="badge">{health.isError ? "Offline" : data ? "Online" : "..."}</span>
      </div>
      {health.isError ? (
        <p className="error">
          Could not reach {relayer}. Start it with <code>npm run relayer</code>.
        </p>
      ) : data ? (
        <>
          <dl>
            <dt>Address</dt>
            <dd className="mono">
              <a href={addressLink(data.relayer)} target="_blank" rel="noreferrer">
                {data.relayer}
              </a>
            </dd>
            <dt>Balance</dt>
            <dd className="mono">
              {Number(data.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {coin}
            </dd>
            <dt>Paymaster</dt>
            <dd>{data.paymaster ? "On" : "Off (the relayer pays)"}</dd>
          </dl>
          {data.chainId !== targetChain.id ? (
            <p className="error">
              The relayer is on chain {data.chainId}, but this app is on {targetChain.name}.
            </p>
          ) : null}
          {data.lowBalance ? (
            <p className="error">The relayer is low on {coin}. Top it up from the faucet so it can keep paying.</p>
          ) : null}
        </>
      ) : (
        <p className="muted">Loading...</p>
      )}
    </section>
  )
}
