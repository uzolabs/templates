import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { formatUnits, isAddress, isAddressEqual, parseUnits, zeroAddress, type Address } from "viem"
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { uzoTokenAbi } from "./abi"
import { ConnectButton } from "./components/ConnectButton"
import { TxStatus } from "./components/TxStatus"
import { addressLink, targetChain } from "./wagmi"

const envAddress = import.meta.env.VITE_CONTRACT_ADDRESS
const tokenAddress = envAddress && isAddress(envAddress) ? envAddress : undefined

/** 1234567.5 -> 1,234,567.5. Works on the string, so large amounts keep every digit. */
const group = (amount: string) => {
  const [whole = "0", fraction] = amount.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return fraction ? `${grouped}.${fraction}` : grouped
}

export function App() {
  return (
    <div className="page">
      <div className="topbar">
        <span className="badge">{targetChain.name}</span>
        <ConnectButton />
      </div>
      {tokenAddress ? <Token address={tokenAddress} /> : <NotDeployed />}
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
  return (
    <main className="stack">
      <Hero
        eyebrow="Token template"
        title="Deploy your token first"
        lede="This app talks to your token once it is on chain."
      />
      <section className="card">
        <h2>No token address yet</h2>
        <p>
          Run <code>npm run deploy</code> in the project folder. It writes <code>VITE_CONTRACT_ADDRESS</code> to{" "}
          <code>frontend/.env</code>. Then restart <code>npm run frontend</code>.
        </p>
      </section>
    </main>
  )
}

function Token({ address }: { address: Address }) {
  const { address: account, chainId } = useAccount()
  const onRightChain = chainId === targetChain.id
  const token = { address, abi: uzoTokenAbi, chainId: targetChain.id } as const

  // Polling reads instead of event subscriptions: BOT Chain RPCs do not serve eth_getLogs.
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...token, functionName: "name" },
      { ...token, functionName: "symbol" },
      { ...token, functionName: "decimals" },
      { ...token, functionName: "totalSupply" },
      { ...token, functionName: "owner" },
      { ...token, functionName: "balanceOf", args: [account ?? zeroAddress] },
    ],
    allowFailure: false,
    query: { refetchInterval: 10_000 },
  })

  const [name, symbol, decimals, totalSupply, owner, balance] = data ?? []
  const isOwner = !!account && !!owner && isAddressEqual(account, owner)
  const fmt = (value?: bigint) =>
    value === undefined || decimals === undefined ? "..." : group(formatUnits(value, decimals))

  return (
    <main className="stack">
      <Hero
        eyebrow={`ERC-20 on ${targetChain.name}`}
        title={name ?? "..."}
        lede={`Send ${symbol ?? "tokens"} to any address. The owner can also mint more.`}
      />

      <section className="card" aria-labelledby="balance-title">
        <p id="balance-title" className="eyebrow">
          Your balance
        </p>
        <p className="amount">
          {account ? (
            <>
              {fmt(balance)} <span className="muted">{symbol}</span>
            </>
          ) : (
            <span className="muted">Connect your wallet</span>
          )}
        </p>
        <dl>
          <dt>Total supply</dt>
          <dd className="mono">
            {fmt(totalSupply)} {symbol}
          </dd>
          <dt>Contract</dt>
          <dd className="mono">
            <a href={addressLink(address)} target="_blank" rel="noreferrer">
              {address}
            </a>
          </dd>
        </dl>
      </section>

      {account && onRightChain && decimals !== undefined ? (
        <>
          <AmountForm
            token={address}
            functionName="transfer"
            title="Send"
            action={`Send ${symbol ?? ""}`}
            decimals={decimals}
            onSuccess={refetch}
          />
          {isOwner ? (
            <AmountForm
              token={address}
              functionName="mint"
              title="Mint"
              badge="Owner only"
              action={`Mint ${symbol ?? ""}`}
              decimals={decimals}
              defaultTo={account}
              onSuccess={refetch}
            />
          ) : null}
        </>
      ) : null}
    </main>
  )
}

type AmountFormProps = {
  token: Address
  /** Both take (address to, uint256 amount). */
  functionName: "transfer" | "mint"
  title: string
  badge?: string
  action: string
  decimals: number
  defaultTo?: string
  onSuccess: () => void
}

function AmountForm({
  token,
  functionName,
  title,
  badge,
  action,
  decimals,
  defaultTo = "",
  onSuccess,
}: AmountFormProps) {
  const [to, setTo] = useState(defaultTo)
  const [amount, setAmount] = useState("")
  const [inputError, setInputError] = useState<string>()
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: targetChain.id })

  useEffect(() => {
    if (receipt.isSuccess) onSuccess()
  }, [receipt.isSuccess, onSuccess])

  function submit(event: FormEvent) {
    event.preventDefault()
    reset()
    setInputError(undefined)
    if (!isAddress(to)) return setInputError("Enter a valid address: 0x followed by 40 hex characters.")
    let value: bigint
    try {
      value = parseUnits(amount, decimals)
    } catch {
      return setInputError("Enter a number, for example 1.5")
    }
    if (value <= 0n) return setInputError("Enter an amount above zero.")
    writeContract({ address: token, abi: uzoTokenAbi, chainId: targetChain.id, functionName, args: [to, value] })
  }

  const busy = isPending || receipt.isLoading
  const receiptError = receipt.data?.status === "reverted" ? new Error("The transaction reverted.") : receipt.error
  const id = `${functionName}-form`

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <div className="row">
        <h2 id={`${id}-title`}>{title}</h2>
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      <form onSubmit={submit} noValidate>
        <label htmlFor={`${id}-to`}>To</label>
        <input
          id={`${id}-to`}
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder="0x..."
          autoComplete="off"
          spellCheck={false}
        />
        <label htmlFor={`${id}-amount`}>Amount</label>
        <input
          id={`${id}-amount`}
          value={amount}
          onChange={(e) => setAmount(e.target.value.trim())}
          placeholder="0.0"
          inputMode="decimal"
          autoComplete="off"
        />
        <button type="submit" disabled={busy}>
          {busy ? "Working..." : action}
        </button>
      </form>
      {inputError ? (
        <div className="status" aria-live="polite">
          <p className="error">{inputError}</p>
        </div>
      ) : (
        <TxStatus
          hash={hash}
          isSigning={isPending}
          isConfirming={receipt.isLoading}
          isSuccess={receipt.isSuccess && receipt.data?.status === "success"}
          error={error ?? receiptError}
        />
      )}
    </section>
  )
}
