// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

interface ISimplePlugin {
    function increaseClaimableBy(address account, uint256 amount) external returns (bool);
}