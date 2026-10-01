// Wallet connect, wrong-network switch, address and native balance.
// Maintainers: this file is copied from _shared/frontend/ConnectButton.tsx. Edit it there, then run `npm run sync`.
import { useEffect, useRef, useState } from "react"
import { formatEther } from "viem"
import { type Connector, useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi"
import { addressLink, targetChain } from "../wagmi"

const shorten = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`

export function ConnectButton() {
  const { address, chainId, isConnected } = useAccount()
  const { connect, connectors, isPending, error: connectError } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain()
  const { data: balance } = useBalance({ address, chainId: targetChain.id, query: { refetchInterval: 10_000 } })
  const [noWallet, setNoWallet] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close the wallet list on Escape or a click anywhere else.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false)
    const onPointer = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [menuOpen])

  if (!isConnected) {
    // Wallet extensions that announce themselves (EIP-6963) are listed by name, so with several installed you pick one
    // instead of getting whichever claimed window.ethereum. The generic injected connector is the fallback.
    const announced = connectors.filter((c) => c.id !== "injected")
    const choices = announced.length > 0 ? announced : connectors.slice(0, 1)
    const onConnect = (connector: Connector) => {
      setMenuOpen(false)
      // The injected connector needs a wallet extension, or a wallet app's built-in browser.
      const hasWallet = announced.length > 0 || (typeof window !== "undefined" && "ethereum" in window)
      setNoWallet(!hasWallet)
      if (hasWallet) connect({ connector, chainId: targetChain.id })
    }
    // One wallet connects straight away; more than one opens the list.
    const onClick = () => (choices.length > 1 ? setMenuOpen((open) => !open) : choices[0] && onConnect(choices[0]))
    return (
      <div className="wallet">
        <div className="wallet-picker" ref={pickerRef}>
          <button
            onClick={onClick}
            disabled={isPending}
            aria-haspopup={choices.length > 1 ? "true" : undefined}
            aria-expanded={choices.length > 1 ? menuOpen : undefined}
          >
            {isPending ? "Check your wallet..." : "Connect wallet"}
          </button>
          {menuOpen ? (
            <ul className="wallet-menu" aria-label="Choose a wallet">
              {choices.map((connector) => (
                <li key={connector.uid}>
                  <button className="secondary" onClick={() => onConnect(connector)}>
                    {connector.icon ? <img src={connector.icon} alt="" width={20} height={20} /> : null}
                    {connector.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="status" aria-live="polite">
          {noWallet ? (
            <p className="error">
              No browser wallet found. Install MetaMask (or open this page in your wallet app), then reload.
            </p>
          ) : connectError ? (
            <p className="error">{connectError.message.split("\n")[0]}</p>
          ) : null}
        </div>
      </div>
    )
  }

  if (chainId !== targetChain.id) {
    return (
      <div className="wallet">
        <button onClick={() => switchChain({ chainId: targetChain.id })} disabled={isSwitching}>
          {isSwitching ? "Check your wallet..." : `Switch to ${targetChain.name}`}
        </button>
        <div className="status" aria-live="polite">
          {switchError ? <p className="error">{switchError.message.split("\n")[0]}</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="wallet">
      <a className="chip" href={addressLink(address!)} target="_blank" rel="noreferrer" title="View on BOTScan">
        {shorten(address!)}
        <span className="muted">
          {balance ? `${Number(formatEther(balance.value)).toFixed(4)} ${targetChain.nativeCurrency.symbol}` : "..."}
        </span>
      </a>
      <button className="secondary" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  )
}
