// Wraps BOT into WBOT (or back). WBOT is the ERC-20 version of BOT that pools trade, always worth exactly 1 BOT.
//
//   npm run wrap -- 0.5              0.5 BOT in, 0.5 WBOT out
//   npm run wrap -- 0.5 --unwrap     0.5 WBOT in, 0.5 BOT out
//   npm run wrap -- 0.5 --mainnet
import { wbotAbi } from "@uzolabs/sdk/contracts"
import { amountArg, formatToken, getDex, parseArgs, printBalances, readBalances } from "./lib/cli.js"
import { confirmMainnet, fail, loadEnv } from "./lib/network.js"
import { getSigner, sendAndWait } from "./lib/tx.js"

const USAGE = "Usage: npm run wrap -- <amount>, or npm run wrap -- <amount> --unwrap"

loadEnv()
const { positionals, flags } = parseArgs()
const unwrap = flags.has("unwrap")
const signer = await getSigner()
const { publicClient, walletClient, account, net } = signer
const { tokens } = getDex(net)
const from = unwrap ? tokens.WBOT : tokens.BOT
const to = unwrap ? tokens.BOT : tokens.WBOT
const amount = amountArg(positionals[0], from, USAGE)

const before = await readBalances(publicClient, tokens, account.address)
printBalances("Before", tokens, before)
if (before[from.symbol] < amount)
  fail(
    `You have ${formatToken(before[from.symbol], from)}, not enough to ${unwrap ? "unwrap" : "wrap"} ${formatToken(amount, from)}.`,
  )

await confirmMainnet(net, `${unwrap ? "unwrap" : "wrap"} ${formatToken(amount, from)}`)
await sendAndWait(signer, unwrap ? "Unwrap" : "Wrap", async () => {
  const wbot = { account, address: tokens.WBOT.address, abi: wbotAbi } as const
  if (unwrap) {
    // withdraw(amount) burns WBOT and sends the same amount of BOT back.
    const { request } = await publicClient.simulateContract({ ...wbot, functionName: "withdraw", args: [amount] })
    return walletClient.writeContract(request)
  }
  // deposit() takes BOT as the transaction value and mints the same amount of WBOT.
  const { request } = await publicClient.simulateContract({ ...wbot, functionName: "deposit", value: amount })
  return walletClient.writeContract(request)
})

printBalances("After", tokens, await readBalances(publicClient, tokens, account.address), before)
console.log(`\n${formatToken(amount, from)} became ${formatToken(amount, to)}. The BOT change also includes gas.`)
