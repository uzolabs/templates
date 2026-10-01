// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {UzoToken} from "../contracts/UzoToken.sol";

/// @notice Deploys UzoToken with the deployer as owner.
/// Run it through `npm run deploy`, which adds the network safety checks and writes the
/// address to frontend/.env and deployments/<chainId>.json.
/// Keep the constructor arguments in sync with ignition/modules/UzoToken.ts.
contract Deploy is Script {
    function run() external returns (UzoToken token) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(deployerKey);

        string memory name = vm.envOr("TOKEN_NAME", string("Uzo Token"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("UZO"));
        // Whole tokens. UzoToken has 18 decimals, so multiply by 1 ether (10**18).
        uint256 initialSupply = vm.envOr("TOKEN_INITIAL_SUPPLY", uint256(1_000_000)) * 1 ether;

        vm.startBroadcast(deployerKey);
        token = new UzoToken(name, symbol, initialSupply, owner);
        vm.stopBroadcast();

        console.log("UzoToken deployed at", address(token));
    }
}
