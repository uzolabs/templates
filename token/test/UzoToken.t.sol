// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UzoToken} from "../contracts/UzoToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract UzoTokenTest is Test {
    UzoToken internal token;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    uint256 internal constant INITIAL_SUPPLY = 1_000_000 ether;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        token = new UzoToken("Uzo Token", "UZO", INITIAL_SUPPLY, owner);
    }

    // ---------- constructor ----------

    function test_Metadata() public view {
        assertEq(token.name(), "Uzo Token");
        assertEq(token.symbol(), "UZO");
        assertEq(token.decimals(), 18);
        assertEq(token.owner(), owner);
    }

    function test_InitialSupplyGoesToOwner() public view {
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY);
    }

    function test_RevertWhen_OwnerIsZero() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new UzoToken("Uzo Token", "UZO", INITIAL_SUPPLY, address(0));
    }

    // ---------- mint ----------

    function test_OwnerCanMint() public {
        vm.prank(owner);
        token.mint(alice, 50 ether);
        assertEq(token.balanceOf(alice), 50 ether);
        assertEq(token.totalSupply(), INITIAL_SUPPLY + 50 ether);
    }

    function test_RevertWhen_NonOwnerMints() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1 ether);
    }

    function test_RevertWhen_MintToZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.mint(address(0), 1 ether);
    }

    // ---------- ownership ----------

    function test_OwnerCanTransferOwnership() public {
        vm.prank(owner);
        token.transferOwnership(alice);
        assertEq(token.owner(), alice);

        vm.prank(alice);
        token.mint(alice, 1 ether);
        assertEq(token.balanceOf(alice), 1 ether);
    }

    function test_RevertWhen_NonOwnerTransfersOwnership() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.transferOwnership(alice);
    }

    // ---------- transfer ----------

    function test_Transfer() public {
        vm.prank(owner);
        assertTrue(token.transfer(alice, 10 ether));
        assertEq(token.balanceOf(alice), 10 ether);
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY - 10 ether);
    }

    function test_RevertWhen_TransferExceedsBalance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 1 ether));
        token.transfer(owner, 1 ether);
    }

    function test_RevertWhen_TransferToZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1 ether);
    }

    function test_ApproveAndTransferFrom() public {
        vm.prank(owner);
        token.approve(alice, 3 ether);

        vm.prank(alice);
        token.transferFrom(owner, alice, 2 ether);

        assertEq(token.balanceOf(alice), 2 ether);
        assertEq(token.allowance(owner, alice), 1 ether);
    }

    function test_RevertWhen_TransferFromExceedsAllowance() public {
        vm.prank(owner);
        token.approve(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, alice, 1 ether, 2 ether)
        );
        token.transferFrom(owner, alice, 2 ether);
    }

    function testFuzz_Transfer(uint256 amount) public {
        amount = bound(amount, 0, INITIAL_SUPPLY);
        vm.prank(owner);
        token.transfer(alice, amount);
        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY - amount);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }

    // ---------- permit ----------

    function _signPermit(uint256 pk, address claimedOwner, address spender, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, claimedOwner, spender, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(pk, digest);
    }

    function test_Permit() public {
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, holder, alice, 5 ether, 0, deadline);

        token.permit(holder, alice, 5 ether, deadline, v, r, s);

        assertEq(token.allowance(holder, alice), 5 ether);
        assertEq(token.nonces(holder), 1);
    }

    function test_RevertWhen_PermitExpired() public {
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, holder, alice, 5 ether, 0, deadline);

        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(ERC20Permit.ERC2612ExpiredSignature.selector, deadline));
        token.permit(holder, alice, 5 ether, deadline, v, r, s);
    }

    function test_RevertWhen_PermitSignedByWrongKey() public {
        address holder = makeAddr("holder");
        (address mallory, uint256 malloryPk) = makeAddrAndKey("mallory");
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        // Mallory signs a permit that claims to come from `holder`.
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(malloryPk, holder, alice, 5 ether, 0, deadline);

        vm.expectRevert(abi.encodeWithSelector(ERC20Permit.ERC2612InvalidSigner.selector, mallory, holder));
        token.permit(holder, alice, 5 ether, deadline, v, r, s);
    }

    function test_RevertWhen_PermitReplayed() public {
        (address holder, uint256 pk) = makeAddrAndKey("holder");
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, holder, alice, 5 ether, 0, deadline);
        token.permit(holder, alice, 5 ether, deadline, v, r, s);

        // The nonce is now 1, so the old signature recovers a different signer and is rejected.
        vm.expectPartialRevert(ERC20Permit.ERC2612InvalidSigner.selector);
        token.permit(holder, alice, 5 ether, deadline, v, r, s);
    }
}
