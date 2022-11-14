// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
/**
 * @title IFeeBuyback
 * @author Amir Shirif, Telcoin, LLC.
 * @notice Helps facilitate a secondary swap, if required, to allow the referrer of a user to receive a fraction of the generated transaction fee, based on the stake of the referrer.
 */
interface IFeeBuyback {
  function submit(address wallet, bytes memory walletData, address token, address recipient, uint256 amount, bytes memory swapData) external payable returns (bool);
}