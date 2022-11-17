// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../libraries/AuxDataLib.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

contract AuxDataLibWrapper {
    using BytesLib for bytes;

    function parse(bytes calldata data) public pure returns (AuxDataLib.HeaderItem[] memory, bytes memory) {
        return AuxDataLib.parse(data);
    }
    
    function selectRelevantBytes(bytes calldata data, address addr) public pure returns (bytes memory) {
        return AuxDataLib.selectRelevantBytes(data, addr);
    }
}