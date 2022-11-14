// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IPlugin.sol";
import "./StakingModule.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Checkpoints.sol";

/// @title Simple Plugin
/// @notice This contract is the simplest IPlugin possible
/// @dev A designated address (`increaser`) can call a function to increase rewards for a given user
contract SimplePlugin is IPlugin, Ownable {
    using Checkpoints for Checkpoints.History;
    using SafeERC20 for IERC20;

    /// @dev This address is allowed to call `increaseClaimableBy`
    address public increaser;

    /// @dev Addres of the StakingModule
    StakingModule public staking;

    /// @dev TEL ERC20 address
    IERC20 public tel;

    /// @dev Amount claimable by an account
    mapping(address => Checkpoints.History) private _claimable;

    /// @dev Total amount claimable by all accounts
    uint256 private _totalOwed;

    /// @notice Event that's emitted when a user claims some rewards
    event Claimed(address indexed account, uint256 amount);
    /// @notice Event that's emitted when a user's claimable rewards are increased
    event ClaimableIncreased(address indexed account, uint256 oldClaimable, uint256 newClaimable);
    /// @notice Event that's emitted when a the increaser is changed
    event IncreaserChanged(address indexed oldIncreaser, address indexed newIncreaser);

    constructor(address _stakingAddress) {
        staking = StakingModule(_stakingAddress);
        tel = IERC20(staking.tel());
    }

    modifier onlyStaking() {
        require(msg.sender == address(staking), "SimplePlugin::onlyStaking: Caller is not StakingModule");
        _;
    }

    modifier onlyIncreaser() {
        require(msg.sender == increaser, "SimplePlugin::onlyIncreaser: Caller is not Increaser");
        _;
    }

    /************************************************
    *   view functions
    ************************************************/

    /// @return amount claimable by `account`
    function claimable(address account, bytes calldata) external view override returns (uint256) {
        return _claimable[account].latest();
    }

    /// @return total amount claimable by all accounts
    function totalClaimable() external view override returns (uint256) {
        return _totalOwed;
    }
    
    /// @return amount claimable by account at a specific block 
    function claimableAt(address account, uint256 blockNumber, bytes calldata) external view override returns (uint256) {
        return _claimable[account].getAtBlock(blockNumber);
    }

    /************************************************
    *   onlyStaking functions
    ************************************************/

    /// @notice Claims all earned yield on behalf of account
    /// @param account the account to claim on behalf of
    /// @param to the account to send the rewards to
    function claim(address account, address to, bytes calldata) external override onlyStaking returns (uint256) {
        uint256 amt = _claimable[account].latest();

        // if claimable amount is 0, do nothing
        if (amt <= 0) {
            return 0;
        }
        
        // update _claimable checkpoints
        _claimable[account].push(0);

        // update _totalOwed
        _totalOwed -= amt;

        // transfer TEL
        tel.safeTransfer(to, amt);

        emit Claimed(account, amt);

        return amt;
    }

    /// @notice Returns true if this plugin requires notifications when users' stakes change
    function requiresNotification() external override pure returns (bool) {
        // This plugin does not require notifications from the staking module.
        return false;
    }
    /// @notice Do nothing
    /// @dev If this function did anything, it would have onlyStaking modifier
    function notifyStakeChange(address, uint256, uint256) external override pure {}

    /************************************************
    *   onlyIncreaser functions
    ************************************************/

    /// @notice increases rewards of an account
    /// @dev This function will pull TEL from the increaser, so this contract must be approved by the increaser first
    /// @param account account to credit tokens to
    /// @param amount amount to credit
    /// @return false if amount is 0, otherwise true
    function increaseClaimableBy(address account, uint256 amount) external onlyIncreaser returns (bool) {
        // if amount is zero do nothing
        if (amount == 0) {
            return false;
        }

        // keep track of old claimable and new claimable
        uint256 oldClaimable = _claimable[account].latest();
        uint256 newClaimable = oldClaimable + amount;

        // update _claimable[account] with newClaimable
        _claimable[account].push(newClaimable);

        // update _totalOwed
        _totalOwed += amount;

        // transfer TEL
        tel.safeTransferFrom(msg.sender, address(this), amount);

        emit ClaimableIncreased(account, oldClaimable, newClaimable);

        return true;
    }

    /************************************************
    *   onlyOwner functions
    ************************************************/

    /// @notice Sets increaser address
    /// @dev Only callable by contract Owner
    function setIncreaser(address newIncreaser) external onlyOwner {
        address old = increaser;
        increaser = newIncreaser;
        emit IncreaserChanged(old, increaser);
    }

    /// @notice rescues any stuck erc20
    /// @dev if the token is TEL, then it only allows maximum of balanceOf(this) - _totalOwed to be rescued
    function rescueTokens(IERC20 token, address to) external onlyOwner {
        if (token == tel) {
            // if the token is TEL, only send the extra amount. Do not send anything that is meant for users.
            token.safeTransfer(to, token.balanceOf(address(this)) - _totalOwed);
        }
        else {
            // if the token isn't TEL, it's not supposed to be here. Send all of it.
            token.safeTransfer(to, token.balanceOf(address(this)));
        }
    }
}