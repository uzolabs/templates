This is a learning template. It has not been audited. Use test funds only unless you know what you are doing.

# Contributing

Thanks for helping. This repo holds clone-and-deploy starter templates for BOT Chain. Each template folder must work on its own after someone copies just that folder, so most of the rules below exist to keep templates standalone and safe for beginners.

## Repo layout

```
_shared/                  files copied into every template (edit them here, never in a template)
scripts/sync-shared.ts    copies _shared/ into each template; --check reports drift
scripts/check-template.ts checks a template against the rules below
.github/workflows/        ci.yml (every PR) and testnet-deploy.yml (nightly, testnet only)
token/                    one folder per template
```

## Setup

You need Node 20.19 or newer and [Foundry](https://getfoundry.sh).

```bash
npm install
npm run format:check
npm run sync:check
npm run check
```

Code style matches the Uzo Labs website: no semicolons, double quotes, 120 columns. `npm run format` applies it to TypeScript and CSS. Solidity, JSON and Markdown are left as written.

## Editing shared files

Files that come from `_shared/` start with a comment saying so (JSON files cannot hold comments; `npm run sync:check` still covers them). To change one:

1. Edit it in `_shared/`.
2. Run `npm run sync` to copy it into every template.
3. Run the template tests, then commit `_shared/` and the templates together.

CI fails if a template's copy differs from `_shared/`.

`.env.example` is merged rather than copied. The top part comes from `_shared/.env.example.base`. Everything from the line `# --- <template> template ---` down belongs to the template and is kept as is.

## Rules for every template

1. Never hard-code chain IDs, RPC URLs, contract addresses or pool addresses in template source. Use `@uzolabs/sdk`, environment variables or runtime lookups.
2. Never commit a private key, mnemonic or API key. That includes tests, examples and CI config. Keys live in a git-ignored `.env`; only `.env.example` is committed.
3. Never use `eth_getLogs` or log-based hooks (`useWatchContractEvent`, `getLogs`, `getContractEvents`) in frontends. Poll reads instead.
4. Never add a dependency without writing the reason in the template README.
5. If something about BOT Chain is still unknown, make it a config option or leave it out. Do not guess.
6. No em dashes in READMEs, comments or UI text.
7. Every README starts with the learning-template disclaimer and ends with the independence note (see any template README).
8. Testnet is the default. Mainnet needs `--mainnet` or `MAINNET=true` plus a typed confirmation.
9. No imports from sibling folders or from `_shared/` at runtime.
10. Foundry and Hardhat 3 must both compile, test, deploy and verify from the same `contracts/` and `test/`.

`npm run check` enforces the rules that a script can check. Reviewers check the rest.

## Adding a template

1. Copy `token/` as a starting point and rename it.
2. Replace the contract, tests, deploy script, Ignition module and frontend.
3. Add the folder to the `template` matrix in both workflow files.
4. Deploy and verify it on testnet with both toolchains, and paste the real commands and output into its README.
5. Run `npm run check -- <name>` until it passes.

## Pull requests

- Keep each PR to one template or one shared change.
- Run the template's `npm test`, `npm run test:hardhat` and `npm --prefix frontend run build`.
- Never paste real keys, even testnet ones, into issues or PRs.

Uzo Labs is an independent project and is not affiliated with or endorsed by BOT Chain.
