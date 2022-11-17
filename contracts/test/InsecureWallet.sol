// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

//TESTING ONLY
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract InsecureWallet {
  event Sent(address indexed recipient, uint amount);
  address public _address;
  string public _message;

  event Please(uint256 value);

  function approveTokens(address token, address spender, uint256 amount) external {
    require(IERC20(token).approve(spender, amount), "InsecureWallet: approve was not successful");
  }

  function transferTokens(address token, address recipient, uint256 amount) external {
    require(IERC20(token).transfer(recipient, amount), "InsecureWallet: transfer was not successful");
  }

  function transferFromTokens(address token, uint256 amount) external {
    require(IERC20(token).transferFrom(msg.sender, address(this), amount), "InsecureWallet: transferFrom was not successful");
  }

  function passSwap(address wallet, address tokenA, address tokenB, uint256 amountA, uint256 amountB) external returns (bool) {
    InsecureWallet(wallet).swapTokens(tokenA, tokenB, amountA, amountB);
    return true;
  }

  function swapTokens(address tokenA, address tokenB, uint256 amountA, uint256 amountB) external returns (bool) {
    require(IERC20(tokenA).transferFrom(msg.sender, address(this), amountA), "InsecureWallet: did not receive tokens");
    require(IERC20(tokenB).transfer(msg.sender, amountB), "InsecureWallet: did not send tokens");
    return true;
  }

  function pay(address payable recipient, uint256 amount) external payable {
    (bool sent,) = recipient.call{value: msg.value}("");
    require(sent, "InsecureWallet: transaction did not proceed");
    emit Sent(recipient, amount);
  }
}
