// wagmi setup shared by every Uzo template frontend.
// Maintainers: this file is copied from _shared/frontend/wagmi.ts. Edit it there, then run `npm run sync`.
import { createConfig, http } from "wagmi"
import { injected } from "wagmi/connectors"
import { botChain, botChainTestnet } from "@uzolabs/sdk/chains"

/**
 * The chain this app talks to, from VITE_CHAIN_ID in frontend/.env (the deploy script writes it where there is one);
 * anything other than mainnet's ID means testnet.
 */
export const targetChain = import.meta.env.VITE_CHAIN_ID === String(botChain.id) ? botChain : botChainTestnet

const rpcOverride = import.meta.env.VITE_RPC_URL || undefined

// Public RPCs sometimes answer 503 or 429 for a few seconds. Retry 5 times with a growing wait, not 3 in about a second.
const rpc = (url?: string) => http(url, { retryCount: 5, retryDelay: 500 })

export const config = createConfig({
  chains: [botChainTestnet, botChain],
  connectors: [injected()],
  // VITE_RPC_URL (optional) points the target chain at another RPC, for example a local node. Blank uses the public one.
  transports: {
    [botChainTestnet.id]: rpc(targetChain.id === botChainTestnet.id ? rpcOverride : undefined),
    [botChain.id]: rpc(targetChain.id === botChain.id ? rpcOverride : undefined),
  },
})

declare module "wagmi" {
  interface Register {
    config: typeof config
  }
}

const explorer = targetChain.blockExplorers.default.url
export const txLink = (hash: string) => `${explorer}/tx/${hash}`
export const addressLink = (address: string) => `${explorer}/address/${address}`
