import { buildModule } from "@nomicfoundation/hardhat-ignition/modules"
import { parseEther } from "viem"

// Deploys UzoNFT with the deployer as owner.
// Keep the constructor arguments in sync with script/Deploy.s.sol.
export default buildModule("UzoNFTModule", (m) => {
  const owner = m.getAccount(0)
  const name = m.getParameter("name", process.env.NFT_NAME || "Uzo NFT")
  const symbol = m.getParameter("symbol", process.env.NFT_SYMBOL || "UZONFT")
  const mintPrice = m.getParameter("mintPrice", parseEther(process.env.NFT_MINT_PRICE || "0.01"))
  const maxSupply = m.getParameter("maxSupply", BigInt(process.env.NFT_MAX_SUPPLY || "1000"))

  const nft = m.contract("UzoNFT", [name, symbol, mintPrice, maxSupply, owner])

  return { nft }
})
