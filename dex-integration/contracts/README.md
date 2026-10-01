# Why there are no contracts here

This template does not deploy anything. It talks to BDEX, the DEX that is already live on BOT Chain:

- the V2 factory and Router02,
- the V3 factory, SwapRouter and QuoterV2,
- WBOT, the ERC-20 version of BOT that the pools trade.

Their addresses and ABIs come from `@uzolabs/sdk/contracts`, and the pool for a pair of tokens is looked up on chain each time a script or the widget runs. Nothing is hard-coded.

If you write your own contract that swaps (for example a vault that rebalances), put it in this folder. The calls it needs are the same ones `scripts/swap-v2.ts` and `scripts/swap-v3.ts` make, and the [token](../../token) and [nft](../../nft) templates show how to set up Foundry and Hardhat for testing and deploying it.
