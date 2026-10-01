// Shows the state of one transaction: waiting for wallet, pending (with BOTScan link), success or a readable error.
// Maintainers: this file is copied from _shared/frontend/TxStatus.tsx. Edit it there, then run `npm run sync`.
import { BaseError, ContractFunctionRevertedError } from "viem"
import { txLink } from "../wagmi"

type Props = {
  hash?: `0x${string}`
  isSigning: boolean
  isConfirming: boolean
  isSuccess: boolean
  error: Error | null
}

/** Turns wallet and contract errors into one readable line. */
export function readableError(error: Error): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => (e as { code?: number }).code === 4001)) return "You rejected the request in your wallet."
    // A custom error from the contract, such as SoldOut, says more than "the function reverted".
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const reason = reverted.data?.errorName ?? reverted.reason
      if (reason) return `The contract rejected this: ${reason}.`
    }
    return error.shortMessage
  }
  return error.message.split("\n")[0]!
}

/** Always rendered, so screen readers announce each change in the live region. */
export function TxStatus({ hash, isSigning, isConfirming, isSuccess, error }: Props) {
  return (
    <div className="status" aria-live="polite">
      <StatusLine hash={hash} isSigning={isSigning} isConfirming={isConfirming} isSuccess={isSuccess} error={error} />
    </div>
  )
}

function StatusLine({ hash, isSigning, isConfirming, isSuccess, error }: Props) {
  if (error) return <p className="error">{readableError(error)}</p>
  if (isSigning) return <p className="muted">Confirm the transaction in your wallet...</p>
  if (!hash) return null
  const link = (
    <a href={txLink(hash)} target="_blank" rel="noreferrer">
      View on BOTScan
    </a>
  )
  if (isConfirming) return <p className="muted">Sent. Waiting for it to be included. {link}</p>
  if (isSuccess) return <p className="success">Confirmed. {link}</p>
  return null
}
