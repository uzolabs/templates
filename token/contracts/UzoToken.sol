// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title UzoToken
/// @notice A minimal ERC-20 for learning: an initial supply for the owner, owner-only minting,
/// and gasless approvals through EIP-2612 `permit`. Uses 18 decimals (the OpenZeppelin default).
/// @dev Learning template. Not audited.
contract UzoToken is ERC20, ERC20Permit, Ownable {
    /// @param name_ Token name, for example "Uzo Token".
    /// @param symbol_ Token symbol, for example "UZO".
    /// @param initialSupply Amount minted to `owner_` at deployment, in the smallest unit (18 decimals).
    /// @param owner_ Receives the initial supply and is the only account allowed to mint.
    constructor(string memory name_, string memory symbol_, uint256 initialSupply, address owner_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        Ownable(owner_)
    {
        _mint(owner_, initialSupply);
    }

    /// @notice Create `amount` new tokens and send them to `to`. Only the owner can call this.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
