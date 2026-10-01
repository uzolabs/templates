// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UzoNFT} from "../contracts/UzoNFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// Refuses plain BOT transfers, to test the WithdrawFailed path.
contract RejectingOwner {
    receive() external payable {
        revert("no thanks");
    }
}

/// Tries to mint again from inside onERC721Received.
contract ReentrantMinter {
    UzoNFT internal nft;

    constructor(UzoNFT nft_) payable {
        nft = nft_;
    }

    function start() external {
        nft.mint{value: nft.mintPrice()}();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        nft.mint{value: nft.mintPrice()}();
        return this.onERC721Received.selector;
    }
}

/// A contract with no onERC721Received, so _safeMint must refuse to send to it.
contract NotAReceiver {
    function mint(UzoNFT nft) external payable {
        nft.mint{value: msg.value}();
    }
}

contract UzoNFTTest is Test {
    UzoNFT internal nft;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal constant PRICE = 0.01 ether;
    uint256 internal constant MAX_SUPPLY = 1000;

    function setUp() public {
        nft = new UzoNFT("Uzo NFT", "UZONFT", PRICE, MAX_SUPPLY, owner);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _mintAs(address who) internal returns (uint256) {
        uint256 price = nft.mintPrice(); // read first: vm.prank applies to the very next call only
        vm.prank(who);
        return nft.mint{value: price}();
    }

    // ---------- constructor ----------

    function test_Constructor() public view {
        assertEq(nft.name(), "Uzo NFT");
        assertEq(nft.symbol(), "UZONFT");
        assertEq(nft.mintPrice(), PRICE);
        assertEq(nft.maxSupply(), MAX_SUPPLY);
        assertEq(nft.owner(), owner);
        assertEq(nft.totalSupply(), 0);
        assertEq(nft.remainingSupply(), MAX_SUPPLY);
    }

    function test_RevertWhen_MaxSupplyIsZero() public {
        vm.expectRevert(UzoNFT.MaxSupplyIsZero.selector);
        new UzoNFT("Uzo NFT", "UZONFT", PRICE, 0, owner);
    }

    function test_RevertWhen_OwnerIsZero() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new UzoNFT("Uzo NFT", "UZONFT", PRICE, MAX_SUPPLY, address(0));
    }

    function test_SupportsInterfaces() public view {
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC721Metadata).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC721Enumerable).interfaceId));
        assertFalse(nft.supportsInterface(0xffffffff));
    }

    // ---------- mint ----------

    function test_MintAtCorrectPrice() public {
        vm.expectEmit(true, true, false, false, address(nft));
        emit UzoNFT.Minted(alice, 1);
        uint256 id = _mintAs(alice);

        assertEq(id, 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.balanceOf(alice), 1);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.remainingSupply(), MAX_SUPPLY - 1);
        assertEq(address(nft).balance, PRICE);
    }

    function test_MintIdsCountUp() public {
        assertEq(_mintAs(alice), 1);
        assertEq(_mintAs(bob), 2);
        assertEq(_mintAs(alice), 3);
        assertEq(nft.tokenOfOwnerByIndex(alice, 0), 1);
        assertEq(nft.tokenOfOwnerByIndex(alice, 1), 3);
        assertEq(nft.tokenOfOwnerByIndex(bob, 0), 2);
        assertEq(nft.tokenByIndex(1), 2);
    }

    function test_RevertWhen_PriceTooLow() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UzoNFT.WrongPayment.selector, PRICE - 1, PRICE));
        nft.mint{value: PRICE - 1}();
    }

    function test_RevertWhen_PriceTooHigh() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UzoNFT.WrongPayment.selector, PRICE + 1, PRICE));
        nft.mint{value: PRICE + 1}();
    }

    function test_RevertWhen_PastMaxSupply() public {
        UzoNFT small = new UzoNFT("Small", "SML", PRICE, 2, owner);
        vm.startPrank(alice);
        small.mint{value: PRICE}();
        small.mint{value: PRICE}();
        assertEq(small.remainingSupply(), 0);
        vm.expectRevert(UzoNFT.SoldOut.selector);
        small.mint{value: PRICE}();
        vm.stopPrank();
    }

    function test_FreeMintWhenPriceIsZero() public {
        vm.prank(owner);
        nft.setMintPrice(0);
        vm.prank(alice);
        nft.mint();
        assertEq(nft.balanceOf(alice), 1);
    }

    function test_RevertWhen_MintCallbackReenters() public {
        ReentrantMinter attacker = new ReentrantMinter{value: 1 ether}(nft);
        // The inner mint hits nonReentrant; _safeMint then reports the failed callback.
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.start();
        assertEq(nft.totalSupply(), 0);
    }

    function test_RevertWhen_ContractCannotReceive() public {
        NotAReceiver receiver = new NotAReceiver();
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(receiver)));
        receiver.mint{value: PRICE}(nft);
    }

    // ---------- tokenURI ----------

    function test_TokenURIIsBase64Json() public {
        _mintAs(alice);
        string memory uri = nft.tokenURI(1);

        string memory prefix = "data:application/json;base64,";
        assertTrue(_startsWith(uri, prefix), "missing data URI prefix");

        string memory json = string(Base64.decode(_slice(uri, bytes(prefix).length)));
        assertEq(vm.parseJsonString(json, ".name"), "Uzo NFT #1");
        assertTrue(bytes(vm.parseJsonString(json, ".description")).length > 0);

        string memory image = vm.parseJsonString(json, ".image");
        string memory imagePrefix = "data:image/svg+xml;base64,";
        assertTrue(_startsWith(image, imagePrefix), "image is not an SVG data URI");

        string memory svg = string(Base64.decode(_slice(image, bytes(imagePrefix).length)));
        assertTrue(_startsWith(svg, "<svg"), "image does not decode to an SVG");
        assertTrue(_contains(svg, ">#1</text>"), "SVG does not show the token ID");

        uint256 hue = vm.parseJsonUint(json, ".attributes[0].value");
        assertLt(hue, 360);
    }

    function test_TokenURIEscapesName() public {
        UzoNFT quoted = new UzoNFT('The "Quoted" One', "Q", PRICE, 10, owner);
        vm.prank(alice);
        quoted.mint{value: PRICE}();
        string memory uri = quoted.tokenURI(1);
        string memory json = string(Base64.decode(_slice(uri, 29)));
        assertEq(vm.parseJsonString(json, ".name"), 'The "Quoted" One #1');
    }

    function test_TokenURIDiffersPerToken() public {
        _mintAs(alice);
        _mintAs(alice);
        assertNotEq(nft.tokenURI(1), nft.tokenURI(2));
    }

    function test_RevertWhen_TokenURIForMissingToken() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        nft.tokenURI(1);
    }

    // ---------- setMintPrice ----------

    function test_OwnerCanSetMintPrice() public {
        vm.expectEmit(false, false, false, true, address(nft));
        emit UzoNFT.MintPriceChanged(PRICE, 1 ether);
        vm.prank(owner);
        nft.setMintPrice(1 ether);
        assertEq(nft.mintPrice(), 1 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UzoNFT.WrongPayment.selector, PRICE, 1 ether));
        nft.mint{value: PRICE}();
    }

    function test_RevertWhen_NonOwnerSetsMintPrice() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        nft.setMintPrice(0);
    }

    // ---------- withdraw ----------

    function test_OwnerCanWithdraw() public {
        _mintAs(alice);
        _mintAs(bob);
        uint256 before = owner.balance;

        vm.expectEmit(true, false, false, true, address(nft));
        emit UzoNFT.Withdrawn(owner, 2 * PRICE);
        vm.prank(owner);
        nft.withdraw();

        assertEq(owner.balance, before + 2 * PRICE);
        assertEq(address(nft).balance, 0);
    }

    function test_RevertWhen_NonOwnerWithdraws() public {
        _mintAs(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        nft.withdraw();
    }

    function test_RevertWhen_NothingToWithdraw() public {
        vm.prank(owner);
        vm.expectRevert(UzoNFT.NothingToWithdraw.selector);
        nft.withdraw();
    }

    function test_RevertWhen_OwnerRejectsPayment() public {
        RejectingOwner rejecting = new RejectingOwner();
        UzoNFT stuck = new UzoNFT("Stuck", "STK", PRICE, 10, address(rejecting));
        vm.prank(alice);
        stuck.mint{value: PRICE}();
        vm.prank(address(rejecting));
        vm.expectRevert(UzoNFT.WithdrawFailed.selector);
        stuck.withdraw();
        assertEq(address(stuck).balance, PRICE);
    }

    function test_WithdrawGoesToNewOwnerAfterTransfer() public {
        _mintAs(alice);
        vm.prank(owner);
        nft.transferOwnership(bob);
        uint256 before = bob.balance;
        vm.prank(bob);
        nft.withdraw();
        assertEq(bob.balance, before + PRICE);
    }

    // ---------- transfers keep the enumeration right ----------

    function test_TransferUpdatesEnumeration() public {
        _mintAs(alice);
        _mintAs(alice);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        assertEq(nft.balanceOf(alice), 1);
        assertEq(nft.tokenOfOwnerByIndex(alice, 0), 2);
        assertEq(nft.tokenOfOwnerByIndex(bob, 0), 1);
    }

    // ---------- fuzz ----------

    function testFuzz_RevertWhen_WrongPrice(uint256 sent) public {
        sent = bound(sent, 0, 100 ether);
        vm.assume(sent != PRICE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UzoNFT.WrongPayment.selector, sent, PRICE));
        nft.mint{value: sent}();
    }

    function testFuzz_MintAtAnyPrice(uint256 price) public {
        price = bound(price, 0, 50 ether);
        vm.prank(owner);
        nft.setMintPrice(price);
        vm.prank(alice);
        nft.mint{value: price}();
        assertEq(address(nft).balance, price);
    }

    function testFuzz_WithdrawSumsAllMints(uint8 mints, uint96 price) public {
        uint256 count = bound(mints, 1, 20);
        uint256 p = bound(price, 1, 2 ether);
        vm.prank(owner);
        nft.setMintPrice(p);
        for (uint256 i; i < count; i++) _mintAs(alice);

        assertEq(nft.remainingSupply(), MAX_SUPPLY - count);
        uint256 before = owner.balance;
        vm.prank(owner);
        nft.withdraw();
        assertEq(owner.balance - before, count * p);
    }

    function testFuzz_SupplyNeverPassesMax(uint8 maxSupply, uint8 attempts) public {
        uint256 max = bound(maxSupply, 1, 30);
        uint256 tries = bound(attempts, 0, 40);
        UzoNFT capped = new UzoNFT("Capped", "CAP", 0, max, owner);
        for (uint256 i; i < tries; i++) {
            vm.prank(alice);
            if (i < max) {
                capped.mint();
            } else {
                vm.expectRevert(UzoNFT.SoldOut.selector);
                capped.mint();
            }
        }
        assertEq(capped.totalSupply(), tries < max ? tries : max);
        assertEq(capped.remainingSupply(), max - capped.totalSupply());
    }

    // ---------- string helpers ----------

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(prefix);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    function _contains(string memory s, string memory part) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(part);
        if (b.length > a.length) return false;
        for (uint256 i; i <= a.length - b.length; i++) {
            bool hit = true;
            for (uint256 j; j < b.length && hit; j++) if (a[i + j] != b[j]) hit = false;
            if (hit) return true;
        }
        return false;
    }

    function _slice(string memory s, uint256 start) internal pure returns (string memory) {
        bytes memory a = bytes(s);
        bytes memory out = new bytes(a.length - start);
        for (uint256 i; i < out.length; i++) out[i] = a[start + i];
        return string(out);
    }
}
