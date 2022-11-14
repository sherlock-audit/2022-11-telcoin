// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IPlugin.sol";

contract MockStakingModule {
    address public tel;

    address private fb;

    constructor(address _tel) {
        tel = _tel;
    }
    
    function setFb(address _fb) external {
        fb = _fb;
    }

    function notifyStakeChange(address account, uint256 amountBefore, uint256 amountAfter) external {
        IPlugin(fb).notifyStakeChange(account, amountBefore, amountAfter);
    }

    function claimWithArbitraryParams(address account, address to, bytes calldata auxData) external {
        IPlugin(fb).claim(account, to, auxData);        
    }

    function claim(bytes calldata auxData) external {
        IPlugin(fb).claim(msg.sender, msg.sender, auxData);
    }
}