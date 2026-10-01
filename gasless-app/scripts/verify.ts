// Verifies the deployed UzoForwarder and GuestBook on BOTScan.
//
//   npm run verify               forge verify-contract --verifier blockscout
//   npm run verify:hardhat       hardhat verify blockscout
//   add `-- --mainnet` to verify a mainnet deployment
//
// Reads the addresses and constructor arguments from deployments/<chainId>.json.
import { encodeConstructorArgs, getDeployment, readForgeAbi, run, runHardhat } from "./lib/deployments.js"
import { addressUrl, getNetwork, loadEnv } from "./lib/network.js"

loadEnv()
const tool = process.argv.includes("hardhat") ? "hardhat" : "foundry"
const net = getNetwork()

for (const contract of ["UzoForwarder", "GuestBook"]) {
  const record = getDeployment(net.chain.id, contract)
  console.log(
    `Verifying ${contract} at ${record.address} on ${net.chain.name} with ${tool === "hardhat" ? "Hardhat" : "Foundry"}\n`,
  )

  if (tool === "foundry") {
    const encodedArgs = encodeConstructorArgs(readForgeAbi(contract), record.constructorArgs)
    const args = [
      "verify-contract",
      record.address,
      record.source,
      "--chain",
      String(net.chain.id),
      "--verifier",
      "blockscout",
      "--verifier-url",
      net.verifierUrl,
      "--watch",
    ]
    if (encodedArgs !== "0x") args.push("--constructor-args", encodedArgs)
    console.log(`> forge ${args.join(" ")}\n`)
    run("forge", args)
  } else {
    const args = ["verify", "blockscout", "--network", net.hardhatNetwork, record.address, ...record.constructorArgs]
    console.log(`> npx hardhat ${args.join(" ")}\n`)
    runHardhat(args)
  }
  console.log(`\nView the verified source at ${addressUrl(net, record.address)}?tab=contract\n`)
}
