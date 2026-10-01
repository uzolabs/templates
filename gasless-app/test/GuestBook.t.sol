// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {GuestBook} from "../contracts/GuestBook.sol";
import {UzoForwarder} from "../contracts/UzoForwarder.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";

contract GuestBookTest is Test {
    UzoForwarder internal forwarder;
    GuestBook internal book;

    // Test keys only. They exist inside this test and never hold funds.
    uint256 internal aliceKey = 0xA11CE;
    uint256 internal malloryKey = 0xBAD;
    address internal alice;
    address internal mallory;
    address internal relayer = makeAddr("relayer");
    address internal bob = makeAddr("bob");

    uint256 internal constant GAS = 200_000;

    bytes32 internal constant FORWARD_REQUEST_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    event Signed(uint256 indexed id, address indexed author, string message);
    event ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success);

    function setUp() public {
        alice = vm.addr(aliceKey);
        mallory = vm.addr(malloryKey);
        forwarder = new UzoForwarder();
        book = new GuestBook(address(forwarder));
        vm.warp(1_700_000_000);
    }

    // ---------------------------------------------------------------- helpers

    function _domainSeparator(address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("UzoForwarder"), keccak256("1"), block.chainid, verifyingContract
            )
        );
    }

    /// Builds a request from `from` to call `target.sign(message)`, signed with `key`.
    function _request(uint256 key, address from, address target, string memory message, uint48 deadline)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory req)
    {
        req = ERC2771Forwarder.ForwardRequestData({
            from: from,
            to: target,
            value: 0,
            gas: GAS,
            deadline: deadline,
            data: abi.encodeCall(GuestBook.sign, (message)),
            signature: ""
        });
        req.signature = _sign(key, req, forwarder.nonces(from));
    }

    function _sign(uint256 key, ERC2771Forwarder.ForwardRequestData memory req, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                FORWARD_REQUEST_TYPEHASH, req.from, req.to, req.value, req.gas, nonce, req.deadline, keccak256(req.data)
            )
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparator(address(forwarder)), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _aliceSigns(string memory message) internal view returns (ERC2771Forwarder.ForwardRequestData memory) {
        return _request(aliceKey, alice, address(book), message, uint48(block.timestamp + 1 hours));
    }

    // ---------------------------------------------------------------- setup and wiring

    function test_ForwarderDomain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            forwarder.eip712Domain();
        assertEq(name, "UzoForwarder");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(forwarder));
    }

    function test_TrustsOnlyItsForwarder() public view {
        assertTrue(book.isTrustedForwarder(address(forwarder)));
        assertFalse(book.isTrustedForwarder(relayer));
        assertEq(book.trustedForwarder(), address(forwarder));
    }

    function test_StartsEmpty() public view {
        assertEq(book.entryCount(), 0);
        assertEq(book.getEntries(0, 10).length, 0);
    }

    // ---------------------------------------------------------------- direct calls

    function test_DirectSign() public {
        vm.expectEmit(address(book));
        emit Signed(0, bob, "hello");
        vm.prank(bob);
        uint256 id = book.sign("hello");

        assertEq(id, 0);
        assertEq(book.entryCount(), 1);
        GuestBook.Entry[] memory entries = book.getEntries(0, 1);
        assertEq(entries[0].author, bob);
        assertEq(entries[0].timestamp, block.timestamp);
        assertEq(entries[0].message, "hello");
    }

    function test_RevertWhen_MessageEmpty() public {
        vm.expectRevert(GuestBook.EmptyMessage.selector);
        vm.prank(bob);
        book.sign("");
    }

    function test_RevertWhen_MessageTooLong() public {
        string memory long = string(new bytes(281));
        vm.expectRevert(abi.encodeWithSelector(GuestBook.MessageTooLong.selector, 281, 280));
        vm.prank(bob);
        book.sign(long);
    }

    function test_AcceptsMaxLengthMessage() public {
        vm.prank(bob);
        book.sign(string(new bytes(280)));
        assertEq(book.entryCount(), 1);
    }

    /// A normal caller cannot pretend to be someone else by appending an address to the calldata.
    /// Only the trusted forwarder's suffix is read.
    function test_DirectCallerCannotSpoofSender() public {
        bytes memory data = abi.encodePacked(abi.encodeCall(GuestBook.sign, ("spoof")), alice);
        vm.prank(bob);
        (bool ok,) = address(book).call(data);
        assertTrue(ok);
        assertEq(book.getEntries(0, 1)[0].author, bob);
    }

    // ---------------------------------------------------------------- forwarded calls

    function test_ForwardedSignRecordsSignerNotRelayer() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("gm from a wallet with no gas");
        assertTrue(forwarder.verify(req));
        assertEq(alice.balance, 0);

        vm.expectEmit(address(book));
        emit Signed(0, alice, "gm from a wallet with no gas");
        vm.expectEmit(address(forwarder));
        emit ExecutedForwardRequest(alice, 0, true);
        vm.prank(relayer);
        forwarder.execute(req);

        GuestBook.Entry[] memory entries = book.getEntries(0, 1);
        assertEq(entries[0].author, alice);
        assertEq(entries[0].message, "gm from a wallet with no gas");
        assertEq(forwarder.nonces(alice), 1);
        assertEq(alice.balance, 0);
    }

    function test_ForwardedSignTwiceUsesNextNonce() public {
        vm.startPrank(relayer);
        forwarder.execute(_aliceSigns("one"));
        forwarder.execute(_aliceSigns("two"));
        vm.stopPrank();

        assertEq(forwarder.nonces(alice), 2);
        GuestBook.Entry[] memory entries = book.getEntries(0, 2);
        assertEq(entries[0].message, "one");
        assertEq(entries[1].message, "two");
        assertEq(entries[1].author, alice);
    }

    function test_RevertWhen_RequestExpired() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("late");
        vm.warp(block.timestamp + 1 hours + 1);

        assertFalse(forwarder.verify(req));
        vm.expectRevert(abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderExpiredRequest.selector, req.deadline));
        vm.prank(relayer);
        forwarder.execute(req);
    }

    function test_ForwardedAtDeadlineStillWorks() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("just in time");
        vm.warp(req.deadline);
        vm.prank(relayer);
        forwarder.execute(req);
        assertEq(book.entryCount(), 1);
    }

    /// After a request runs, the nonce moves on, so the same signature now recovers a different
    /// address and the forwarder rejects it.
    function test_RevertWhen_RequestReplayed() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("once");
        vm.prank(relayer);
        forwarder.execute(req);

        assertFalse(forwarder.verify(req));
        vm.expectPartialRevert(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector);
        vm.prank(relayer);
        forwarder.execute(req);
        assertEq(book.entryCount(), 1);
    }

    function test_RevertWhen_SignedByWrongKey() public {
        // Mallory signs a request that claims to come from Alice.
        ERC2771Forwarder.ForwardRequestData memory req =
            _request(malloryKey, alice, address(book), "not alice", uint48(block.timestamp + 1 hours));

        assertFalse(forwarder.verify(req));
        vm.expectRevert(
            abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector, mallory, alice)
        );
        vm.prank(relayer);
        forwarder.execute(req);
    }

    function test_RevertWhen_MessageChangedAfterSigning() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("original");
        req.data = abi.encodeCall(GuestBook.sign, ("tampered"));

        assertFalse(forwarder.verify(req));
        vm.expectPartialRevert(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector);
        vm.prank(relayer);
        forwarder.execute(req);
    }

    function test_RevertWhen_SignatureMalformed() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("bad bytes");
        req.signature = hex"1234";

        assertFalse(forwarder.verify(req));
        vm.expectRevert(
            abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector, address(0), alice)
        );
        vm.prank(relayer);
        forwarder.execute(req);
    }

    function test_RevertWhen_TargetDoesNotTrustForwarder() public {
        GuestBook other = new GuestBook(address(0xdead));
        ERC2771Forwarder.ForwardRequestData memory req =
            _request(aliceKey, alice, address(other), "wrong book", uint48(block.timestamp + 1 hours));

        assertFalse(forwarder.verify(req));
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC2771Forwarder.ERC2771UntrustfulTarget.selector, address(other), address(forwarder)
            )
        );
        vm.prank(relayer);
        forwarder.execute(req);
    }

    function test_RevertWhen_ValueMismatch() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("no value");
        vm.deal(relayer, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderMismatchedValue.selector, 0, 1));
        vm.prank(relayer);
        forwarder.execute{value: 1}(req);
    }

    /// A valid signature for a call that reverts inside GuestBook: the forwarder reverts too and
    /// the nonce is not used, so nothing is recorded.
    function test_RevertWhen_ForwardedMessageEmpty() public {
        ERC2771Forwarder.ForwardRequestData memory req = _aliceSigns("");
        assertTrue(forwarder.verify(req));

        vm.expectRevert(Errors.FailedCall.selector);
        vm.prank(relayer);
        forwarder.execute(req);
        assertEq(forwarder.nonces(alice), 0);
        assertEq(book.entryCount(), 0);
    }

    // ---------------------------------------------------------------- reading entries

    function _fill(uint256 n) internal {
        for (uint256 i = 0; i < n; i++) {
            vm.prank(address(uint160(0x1000 + i)));
            book.sign(vm.toString(i));
        }
    }

    function test_GetEntriesPages() public {
        _fill(5);
        GuestBook.Entry[] memory page = book.getEntries(1, 3);
        assertEq(page.length, 3);
        assertEq(page[0].message, "1");
        assertEq(page[2].message, "3");
        assertEq(page[2].author, address(uint160(0x1003)));
    }

    function test_GetEntriesClampsAtEnd() public {
        _fill(5);
        GuestBook.Entry[] memory page = book.getEntries(3, 10);
        assertEq(page.length, 2);
        assertEq(page[1].message, "4");
    }

    function test_GetEntriesOffsetPastEnd() public {
        _fill(2);
        assertEq(book.getEntries(2, 10).length, 0);
        assertEq(book.getEntries(type(uint256).max, type(uint256).max).length, 0);
    }

    function test_GetEntriesZeroLimit() public {
        _fill(2);
        assertEq(book.getEntries(0, 0).length, 0);
    }

    function test_GetEntriesCapsPageSize() public {
        _fill(105);
        GuestBook.Entry[] memory page = book.getEntries(0, type(uint256).max);
        assertEq(page.length, book.MAX_PAGE_SIZE());
        assertEq(page[99].message, "99");
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_ForwardedSignRecordsAnySigner(uint256 key, uint16 length, uint48 lifetime) public {
        key = bound(key, 1, type(uint128).max);
        length = uint16(bound(length, 1, 280));
        lifetime = uint48(bound(lifetime, 0, 365 days));
        address signer = vm.addr(key);
        string memory message = string(new bytes(length));

        ERC2771Forwarder.ForwardRequestData memory req =
            _request(key, signer, address(book), message, uint48(block.timestamp) + lifetime);
        vm.prank(relayer);
        forwarder.execute(req);

        GuestBook.Entry[] memory entries = book.getEntries(0, 1);
        assertEq(entries[0].author, signer);
        assertEq(bytes(entries[0].message).length, length);
        assertEq(forwarder.nonces(signer), 1);
    }

    function testFuzz_GetEntriesNeverExceedsBounds(uint8 count, uint256 offset, uint256 limit) public {
        count = uint8(bound(count, 0, 30));
        _fill(count);
        GuestBook.Entry[] memory page = book.getEntries(offset, limit);
        uint256 expected;
        if (offset < count) {
            uint256 capped = limit > 100 ? 100 : limit;
            expected = count - offset < capped ? count - offset : capped;
        }
        assertEq(page.length, expected);
    }
}
