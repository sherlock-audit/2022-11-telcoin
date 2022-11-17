// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPlugin {
    function claim(address account, address to, bytes calldata auxData) external returns (uint256);
    function claimable(address account, bytes calldata auxData) external view returns (uint256);
    function totalClaimable() external view returns (uint256);
    function claimableAt(address account, uint256 blockNumber, bytes calldata auxData) external view returns (uint256);
    function notifyStakeChange(address account, uint256 amountBefore, uint256 amountAfter) external;
    function requiresNotification() external view returns (bool);
}