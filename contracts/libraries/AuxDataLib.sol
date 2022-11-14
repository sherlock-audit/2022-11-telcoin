// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "solidity-bytes-utils/contracts/BytesLib.sol";

/** 
 * @title Auxiliary Data Library
 * @dev This library helps Plugins parse auxiliary data passed to them.
 * 
 * Currently, this library is not being used, but will likely be used in future Plugins
 * 
 * Since multiple Plugins may require auxiliary data for claiming yield, 
 * we must have a way to pack this data into one `bytes` parameter that 
 * can be parsed by the plugins.
 * 
 * This library helps Plugins parse auxiliary data.
 * 
 * auxData is encoded as (HeaderItem[], bytes) "header" and "payload"
 * 
 * Each HeaderItem has an address, start and length
 * 
 * If I am a plugin with address 0x01, I first find the HeaderItem that has 0x01 as the address.
 * Then I get the start and len of that HeaderItem.
 * The information that is relevant to me is payload[start: start+len]
*/
library AuxDataLib {
    using BytesLib for bytes;

    /// @dev The header of a data payload is an array of HeaderItem's
    /// @dev The purpose of the HeaderItem(s) is to let a plugin know which part of the payload is meant for them.
    struct HeaderItem {
        address addr;
        uint256 start;
        uint256 len;
    }

    /// @dev Parse `data` into its HeaderItem's and its payload
    function parse(bytes calldata data) internal pure returns (HeaderItem[] memory, bytes memory) {
        return abi.decode(data, (HeaderItem[], bytes));
    }

    /// @dev Parse `data` and return the data that is relevant to `addr`
    function selectRelevantBytes(bytes calldata data, address addr) internal pure returns (bytes memory) {
        // if data is empty, do nothing and return empty bytes
        if (data.length == 0) {
            return "";
        }

        // parse the data into its header and payload
        (HeaderItem[] memory header, bytes memory payload) = parse(data);

        // iterate over HeaderItems until we find the one that matches addr
        for (uint256 i = 0; i < header.length; i++) {
            if (header[i].addr == addr) {
                // once we have found the correct HeaderItem we slice the payload and return
                return payload.slice(header[i].start, header[i].len);
            }
        }

        // if we never found a HeaderItem corresponding to addr, we return empty bytes
        return "";
    }
}