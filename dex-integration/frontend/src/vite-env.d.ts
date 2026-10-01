/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Written by `npm run deploy` in templates that deploy a contract. */
  readonly VITE_CONTRACT_ADDRESS?: string
  /** 968 is testnet, 677 is mainnet. `npm run deploy` writes it; templates without a deploy step read it from frontend/.env. */
  readonly VITE_CHAIN_ID?: string
  /** Optional. Another RPC for the target chain, for example a local node. */
  readonly VITE_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
