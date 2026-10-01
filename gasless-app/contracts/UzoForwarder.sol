// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title UzoForwarder
/// @notice OpenZeppelin's ERC-2771 forwarder, unchanged. A relayer calls `execute` with a request the
/// user signed off chain (EIP-712). The forwarder checks the signature, the nonce and the deadline, then
/// calls the target with the signer's address appended to the calldata. The relayer pays the gas.
/// @dev The EIP-712 domain is ("UzoForwarder", "1", chainId, this address). Wallets show it when signing.
contract UzoForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("UzoForwarder") {}
}
