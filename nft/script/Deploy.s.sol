// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {UzoNFT} from "../contracts/UzoNFT.sol";

/// @notice Deploys UzoNFT with the deployer as owner.
/// Run it through `npm run deploy`, which adds the network safety checks, converts NFT_MINT_PRICE
/// (in BOT) to NFT_MINT_PRICE_WEI, and writes the address to frontend/.env and deployments/<chainId>.json.
/// Keep the constructor arguments in sync with ignition/modules/UzoNFT.ts.
contract Deploy is Script {
    function run() external returns (UzoNFT nft) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(deployerKey);

        string memory name = vm.envOr("NFT_NAME", string("Uzo NFT"));
        string memory symbol = vm.envOr("NFT_SYMBOL", string("UZONFT"));
        uint256 mintPrice = vm.envOr("NFT_MINT_PRICE_WEI", uint256(0.01 ether));
        uint256 maxSupply = vm.envOr("NFT_MAX_SUPPLY", uint256(1000));

        vm.startBroadcast(deployerKey);
        nft = new UzoNFT(name, symbol, mintPrice, maxSupply, owner);
        vm.stopBroadcast();

        console.log("UzoNFT deployed at", address(nft));
    }
}
