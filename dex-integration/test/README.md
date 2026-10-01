# Why there are no contract tests here

There are no contracts in this template (see [contracts/README.md](../contracts/README.md)), so there is nothing to run Solidity tests against.

The maths the scripts and the widget share (slippage, minimum received, deadline, picking the best route) is tested with Node's built-in test runner in `scripts/lib/math.test.ts`:

```bash
npm test
```

The swaps themselves were checked by running every script, and the widget, against a local fork of BOT Chain Testnet:

```bash
anvil --fork-url <testnet RPC URL> --chain-id 968 --port 8600
```

Then set `BOT_TESTNET_RPC_URL=http://127.0.0.1:8600` in `.env`, and `VITE_RPC_URL=http://127.0.0.1:8600` in `frontend/.env`. On a fork you trade against copies of the real pools, and nothing you do reaches the real testnet. Use one of anvil's test accounts, which start with 10000 BOT.
