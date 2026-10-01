import { buildModule } from "@nomicfoundation/hardhat-ignition/modules"
import { parseEther } from "viem"

// Deploys UzoToken with the deployer as owner.
// Keep the constructor arguments in sync with script/Deploy.s.sol.
export default buildModule("UzoTokenModule", (m) => {
  const owner = m.getAccount(0)
  const name = m.getParameter("name", process.env.TOKEN_NAME || "Uzo Token")
  const symbol = m.getParameter("symbol", process.env.TOKEN_SYMBOL || "UZO")
  const initialSupply = m.getParameter("initialSupply", parseEther(process.env.TOKEN_INITIAL_SUPPLY || "1000000"))

  const token = m.contract("UzoToken", [name, symbol, initialSupply, owner])

  return { token }
})
