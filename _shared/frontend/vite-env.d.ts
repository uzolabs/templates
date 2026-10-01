/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Written by `npm run deploy`. */
  readonly VITE_CONTRACT_ADDRESS?: string
  /** Written by `npm run deploy`. 968 is testnet, 677 is mainnet. */
  readonly VITE_CHAIN_ID?: string
  /** Optional. Another RPC for the target chain, for example a local node. */
  readonly VITE_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
