// Wallet connect, wrong-network switch, address and native balance.
// Maintainers: this file is copied from _shared/frontend/ConnectButton.tsx. Edit it there, then run `npm run sync`.
import { useState } from "react"
import { formatEther } from "viem"
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi"
import { addressLink, targetChain } from "../wagmi"

const shorten = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`

export function ConnectButton() {
  const { address, chainId, isConnected } = useAccount()
  const { connect, connectors, isPending, error: connectError } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain()
  const { data: balance } = useBalance({ address, chainId: targetChain.id, query: { refetchInterval: 10_000 } })
  const [noWallet, setNoWallet] = useState(false)

  if (!isConnected) {
    const onConnect = () => {
      // The injected connector needs a wallet extension, or a wallet app's built-in browser.
      const hasWallet = typeof window !== "undefined" && "ethereum" in window
      setNoWallet(!hasWallet)
      if (hasWallet && connectors[0]) connect({ connector: connectors[0], chainId: targetChain.id })
    }
    return (
      <div className="wallet">
        <button onClick={onConnect} disabled={isPending}>
          {isPending ? "Check your wallet..." : "Connect wallet"}
        </button>
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
