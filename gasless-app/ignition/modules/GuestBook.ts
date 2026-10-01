import { buildModule } from "@nomicfoundation/hardhat-ignition/modules"

// Deploys UzoForwarder, then a GuestBook that trusts it.
// Keep this in sync with script/Deploy.s.sol.
export default buildModule("GuestBookModule", (m) => {
  const forwarder = m.contract("UzoForwarder", [])
  const book = m.contract("GuestBook", [forwarder])

  return { forwarder, book }
})
