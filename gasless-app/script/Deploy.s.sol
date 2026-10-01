// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {UzoForwarder} from "../contracts/UzoForwarder.sol";
import {GuestBook} from "../contracts/GuestBook.sol";

/// @notice Deploys UzoForwarder, then a GuestBook that trusts it.
/// Run it through `npm run deploy`, which adds the network safety checks and writes both addresses
/// to frontend/.env, relayer settings and deployments/<chainId>.json.
/// Keep this in sync with ignition/modules/GuestBook.ts.
contract Deploy is Script {
    function run() external returns (UzoForwarder forwarder, GuestBook book) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        forwarder = new UzoForwarder();
        book = new GuestBook(address(forwarder));
        vm.stopBroadcast();

        console.log("UzoForwarder deployed at", address(forwarder));
        console.log("GuestBook deployed at", address(book));
    }
}
