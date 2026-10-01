This is a learning template. It has not been audited. Use test funds only unless you know what you are doing.

# Uzo Templates

Clone-and-deploy starter projects for [BOT Chain](https://botchain.ai). Each folder is a complete project with a small React frontend. Templates with contracts include tests, deploy and verify scripts for both Foundry and Hardhat 3; templates that use contracts already on chain (such as `dex-integration`) include scripts instead. Copy one folder and you have a working app on BOT Chain testnet in about 15 minutes.

## Templates

| Template | What you get | Status |
| --- | --- | --- |
| [`token`](./token) | ERC-20 with permit and owner minting, plus a transfer and mint UI | Ready |
| [`nft`](./nft) | ERC-721 with on-chain SVG art and metadata, plus a mint page and gallery | Ready |
| [`dex-integration`](./dex-integration) | Pool lookup, quotes, wrap, swap and add-liquidity scripts for BDEX V2 and V3, plus a swap widget. No contracts. | Ready |
| `bridge-integration` | Bridging with the BOT bridge | Planned |
| [`gasless-app`](./gasless-app) | Guest book that wallets with 0 BOT sign for free: ERC-2771 forwarder, a rate-limited relayer, and a web app | Ready |
| `ai-agent` | An agent that acts on BOT Chain | Planned |

"In progress" means the code, tests and CI pass, but the live testnet deploy and verification are not recorded yet. A template moves to "Ready" only after that.

## Start a project

Copy one template (you do not need the rest of this repo):

```bash
npx giget gh:uzolabs/templates/token my-token
```

Then follow the README inside the folder.

## What every template includes

- In templates with contracts:
  - Solidity 0.8.28 (evm `cancun`) with OpenZeppelin 5.
  - The same `contracts/` and `test/` for Foundry and Hardhat 3.
  - `npm run deploy` (Foundry) and `npm run deploy:hardhat` (Ignition). Both print the BOTScan link and the verify command, and write `deployments/<chainId>.json` and `frontend/.env`.
  - `npm run verify` and `npm run verify:hardhat` for BOTScan (a Blockscout explorer, no API key needed).
- A Vite + React 18 + wagmi v2 frontend that works at 360px wide.
- Testnet (chain 968) by default. Anything that sends a transaction on mainnet (chain 677) needs `--mainnet` plus typing `MAINNET` to confirm.
- Chain data and known contract addresses from [`@uzolabs/sdk`](https://www.npmjs.com/package/@uzolabs/sdk), so nothing is hard-coded.

## Networks

| | Testnet | Mainnet |
| --- | --- | --- |
| Chain ID | 968 | 677 |
| RPC | https://rpc.bohr.life | https://rpc.botchain.ai |
| Explorer | https://scan.bohr.life | https://scan.botchain.ai |
| Gas token | tBOT ([faucet](https://faucet.botchain.ai/basic)) | BOT |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Code style: no semicolons, double quotes, 120 columns. Run `npm run format` before you open a pull request.

## License

The code is licensed under [MIT](./LICENSE). Copy it, change it and ship it.

The Uzo name and logo are not covered by that license. If you publish a fork as your own project, give it your own name. The fonts (Satoshi, Reggae One, JetBrains Mono) are loaded from Fontshare and Google Fonts and keep their own licenses.

## Contact

Questions, bugs or ideas: open an issue, or email [uzolabsxyz@gmail.com](mailto:uzolabsxyz@gmail.com).

Uzo Labs is an independent project and is not affiliated with or endorsed by BOT Chain.
