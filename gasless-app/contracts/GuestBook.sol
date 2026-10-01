// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// @title GuestBook
/// @notice Anyone can leave a short message. Messages can arrive directly (the sender pays gas) or
/// through the trusted forwarder (a relayer pays gas). Either way the entry records the person who
/// signed it, because `_msgSender()` reads the original signer from a forwarded call.
/// @dev Entries live in storage and are read with `getEntries`, so apps never need event logs.
contract GuestBook is ERC2771Context {
    struct Entry {
        address author;
        uint64 timestamp;
        string message;
    }

    /// The longest message accepted, in bytes (UTF-8). Keeps storage cost and relayer spend bounded.
    uint256 public constant MAX_MESSAGE_LENGTH = 280;

    /// The most entries `getEntries` returns in one call. Larger limits are cut down to this.
    uint256 public constant MAX_PAGE_SIZE = 100;

    Entry[] private _entries;

    /// Emitted for explorers and indexers. The template's own app reads storage, not this event.
    event Signed(uint256 indexed id, address indexed author, string message);

    error EmptyMessage();
    error MessageTooLong(uint256 length, uint256 maxLength);

    constructor(address trustedForwarder_) ERC2771Context(trustedForwarder_) {}

    /// @notice Adds `message` to the guest book, signed by the caller (or by the forwarded signer).
    function sign(string calldata message) external returns (uint256 id) {
        uint256 length = bytes(message).length;
        if (length == 0) revert EmptyMessage();
        if (length > MAX_MESSAGE_LENGTH) revert MessageTooLong(length, MAX_MESSAGE_LENGTH);

        address author = _msgSender();
        id = _entries.length;
        // casting to uint64 is safe because block.timestamp will not pass 2^64 seconds for billions of years
        // forge-lint: disable-next-line(unsafe-typecast)
        _entries.push(Entry({author: author, timestamp: uint64(block.timestamp), message: message}));
        emit Signed(id, author, message);
    }

    /// @notice How many entries there are.
    function entryCount() external view returns (uint256) {
        return _entries.length;
    }

    /// @notice Returns up to `limit` entries starting at index `offset`, oldest first.
    /// Returns an empty list when `offset` is past the end. `limit` is capped at MAX_PAGE_SIZE.
    /// For the newest N entries, call with offset = max(entryCount() - N, 0).
    function getEntries(uint256 offset, uint256 limit) external view returns (Entry[] memory page) {
        uint256 total = _entries.length;
        if (offset >= total) return new Entry[](0);
        if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
        uint256 end = offset + limit > total ? total : offset + limit;

        page = new Entry[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = _entries[i];
        }
    }
}
