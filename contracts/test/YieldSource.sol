// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IYieldSource {
  function referrer(address referrer_) external returns (address);
  function increaseClaimableBy(address account, uint256 amount) external returns (bool);
}

//TESTING ONLY
contract YieldSource is IYieldSource {
  address public _token;
  address public _referrer;
  address public _referred;
  constructor(address token_, address referrer_, address referred_) {
    _token = token_;
    _referrer = referrer_;
    _referred = referred_;
  }

  function referrer(address referred_) external override view returns (address) {
    if (_referred == referred_) {
      return _referrer;
    }

    return address(0);
  }

  function increaseClaimableBy(address account, uint256 amount) external override returns (bool) {
    require(IERC20(_token).transferFrom(msg.sender, address(this), amount), "YieldSource: transferFrom did not occur");
    if (account == _referrer || account == _referred) {
      return true;
    }

    return false;
  }
}
