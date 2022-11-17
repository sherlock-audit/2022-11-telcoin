// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CheckpointsUpgradeable.sol";

import "./interfaces/IPlugin.sol";

// TODO: improve require messages

/// @title Staking Module
/// @notice Users interact directly with this contract to participate in staking. 
/// @dev This contract holds user funds. It does not accrue any staking yield on its own, it must have one or more `IPlugin` contracts "connected" to it.
contract StakingModule is ReentrancyGuardUpgradeable, AccessControlEnumerableUpgradeable, PausableUpgradeable {
    using CheckpointsUpgradeable for CheckpointsUpgradeable.History;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice This role grants the ability to slash users' stakes at its own discretion
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    /// @notice This role grants the ability to add and remove IPlugin contracts
    bytes32 public constant PLUGIN_EDITOR_ROLE = keccak256("PLUGIN_EDITOR_ROLE");
    /// @notice This role grants the ability to pause all unrestricted external functions in an emergency situation
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice This role grants the ability to rescue ERC20 tokens that do not rightfully belong to this contract
    bytes32 public constant RECOVERY_ROLE = keccak256("RECOVERY_ROLE");

    /// @notice TEL ERC20 address
    address public tel;

    /// @notice Array of all connected IPlugin contracts
    address[] public plugins;

    /// @notice Number of currently connected Plugins
    uint256 public nPlugins;

    /// @notice Maps a Plugin to whether or not it is included in `plugins`
    /// @dev This allows duplicate plugins to be prevented
    mapping(address => bool) public pluginsMapping;

    /// @notice Total TEL staked by users in this contract
    uint256 private _totalStaked;
    /// @notice Maps an account to its staked amount history
    mapping(address => CheckpointsUpgradeable.History) private _stakes;

    /// @notice An event that's emitted when a account's stake changes (deposit/withdraw/slash)
    event StakeChanged(address indexed account, uint256 oldStake, uint256 newStake);
    /// @notice An event that's emitted when an account claims some yield
    event Claimed(address indexed account, uint256 amount);
    /// @notice An event that's emitted when an account's stake is slashed
    event Slashed(address indexed account, uint256 amount);

    /// @notice An event that's emitted when a plugin is added
    event PluginAdded(address indexed plugin, uint256 nPlugins);
    /// @notice An event that's emitted when a plugin is removed
    event PluginRemoved(address indexed plugin, uint256 nPlugins);

    function initialize(address _telAddress) public payable initializer {
        tel = _telAddress;

        // initialize OZ stuff
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init_unchained();
        AccessControlEnumerableUpgradeable.__AccessControlEnumerable_init_unchained();
        PausableUpgradeable.__Pausable_init_unchained();

        // set deployer as ADMIN
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /************************************************
    *   view functions
    ************************************************/

    /// @dev For some future Plugins not yet ideated, totalClaimable may be hard or impossible to implement. 
    /// @dev This would break `totalSupply`, but `totalSupply` is not strictly necessary anyway.
    /// @return Total supply of staked TEL, including all yield
    function totalSupply() external view returns (uint256) {
        uint256 total;

        // loop over all plugins and sum up totalClaimable
        for (uint256 i = 0; i < nPlugins; i++) {
            total += IPlugin(plugins[i]).totalClaimable();
        }
        
        // totalSupply is the total claimable from all plugins plus the total amount staked
        return total + _totalStaked;
    }

    /// @return Balance of an account. This includes stake and claimable yield.
    /// @param account Account to query balance of
    /// @param auxData Auxiliary data to pass to plugins
    function balanceOf(address account, bytes calldata auxData) public view returns (uint256) {
        return _stakes[account].latest() + claimable(account, auxData);
    }

    /// @return Balance of an account at a specific block. This includes stake and claimable yield.
    /// @param account Account to query balance of
    /// @param blockNumber Block at which to query balance
    /// @param auxData Auxiliary data to pass to plugins
    function balanceOfAt(address account, uint256 blockNumber, bytes calldata auxData) external view returns (uint256) {
        return stakedByAt(account, blockNumber) + claimableAt(account, blockNumber, auxData);
    }

    /// @return Total amount staked by all accounts
    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    /// @dev Checks `claimable(account)` of all Plugins and returns the total.
    /// @param account Account to query balance of
    /// @param auxData Auxiliary data to pass to plugins
    /// @return Total amount claimable by an account
    function claimable(address account, bytes calldata auxData) public view returns (uint256) {
        uint256 total;
        // loop over all plugins, sum claimable of account
        for (uint256 i = 0; i < nPlugins; i++) {
            total += IPlugin(plugins[i]).claimable(account, auxData);
        }
        return total;
    }

    /// @dev Checks `claimableAt(account, blockNumber)` of all Plugins.
    /// @param account Account to query claimable amount
    /// @param blockNumber Block at which to query claimable amount
    /// @param auxData Auxiliary data to pass to plugins
    /// @return Total amount claimable by an account at a specific block number.
    function claimableAt(address account, uint256 blockNumber, bytes calldata auxData) public view returns (uint256) {
        uint256 total;
        // loop over all plugins, sum claimableAt of account
        for (uint256 i = 0; i < nPlugins; i++) {
            total += IPlugin(plugins[i]).claimableAt(account, blockNumber, auxData);
        }
        return total;
    }

    /// @return Amount staked by an account. This does not include claimable yield from plugins.
    /// @param account Account to query staked amount
    function stakedBy(address account) external view returns (uint256) {
        return _stakes[account].latest();
    }

    /// @return Amount staked by an account at a specific block number excluding claimable yield.
    /// @param account Account to query staked amount
    /// @param blockNumber Block at which to query staked amount
    function stakedByAt(address account, uint256 blockNumber) public view returns (uint256) {
        return _stakes[account].getAtBlock(blockNumber);
    }

    /************************************************
    *   external mutative functions
    ************************************************/

    /// @notice Stakes some amount of TEL to earn potential rewards.
    /// @param amount Amount to stake
    function stake(uint256 amount) external whenNotPaused nonReentrant {
        _stake({
            account: msg.sender, 
            from: msg.sender, 
            amount: amount
        });
    }

    /// @notice Withdraws staked TEL, does not claim any yield.
    /// @return Amount withdrawn
    function exit() external whenNotPaused nonReentrant returns (uint256) {
        return _exit({
            account: msg.sender, 
            to: msg.sender
        });
    }

    /// @notice Claims yield from an individual plugin and sends it to calling account.
    /// @param pluginIndex Index of desired plugin
    /// @param auxData Auxiliary data for the plugin
    /// @return Amount claimed
    function claimFromIndividualPlugin(uint256 pluginIndex, bytes calldata auxData) external whenNotPaused nonReentrant returns (uint256) {
        return _claimFromIndividualPlugin({
            account: msg.sender, 
            to: msg.sender, 
            pluginIndex: pluginIndex, 
            auxData: auxData
        });
    }

    /// @notice Claims yield from all plugins and sends it to calling account.
    /// @param auxData Auxiliary data for the plugins
    /// @return Amount claimed
    function claim(bytes calldata auxData) external whenNotPaused nonReentrant returns (uint256) {
        return _claim({
            account: msg.sender, 
            to: msg.sender, 
            auxData: auxData
        });
    }

    /// @notice Claims all yield and withdraws all stake.
    /// @param auxData Auxiliary data for the plugins
    /// @return Amount claimed
    /// @return Amount withdrawn
    function fullClaimAndExit(bytes calldata auxData) external whenNotPaused nonReentrant returns (uint256, uint256) {
        return (
            _claim({ account: msg.sender, to: msg.sender, auxData: auxData }), 
            _exit(msg.sender, msg.sender)
        );
    }

    /// @notice Claims yield and withdraws some of stake.
    /// @param amount Amount to withdraw
    /// @param auxData Auxiliary data for the plugins
    function partialClaimAndExit(uint256 amount, bytes calldata auxData) external whenNotPaused nonReentrant {
        _claimAndExit({
            account: msg.sender, 
            amount: amount, 
            to: msg.sender,
            auxData: auxData
        });
    }

    

    /************************************************
    *   private mutative functions
    ************************************************/

    /// @notice Claims earned yield from an individual plugin
    /// @param account Account to claim on behalf of.
    /// @param to Address to send the claimed yield to.
    /// @param pluginIndex Index of the desired plugin to claim from
    /// @dev Calls `claim` on the desired plugin
    /// @dev Checks to make sure the amount of tokens the plugins sent matches what the `claim` functions returned. (Probably unnecessary)
    /// @return Amount claimed
    function _claimFromIndividualPlugin(address account, address to, uint256 pluginIndex, bytes calldata auxData) private returns (uint256) {
        require(pluginIndex < nPlugins, "StakingModule::_claimFromIndividualPlugin: Provided pluginIndex is out of bounds");
        
        // balance of `to` before claiming
        uint256 balBefore = IERC20Upgradeable(tel).balanceOf(to);

        // xClaimed = "amount of TEL claimed from the plugin"
        uint256 xClaimed = IPlugin(plugins[pluginIndex]).claim(account, to, auxData);

        // we want to make sure the plugin did not return the wrong amount
        require(IERC20Upgradeable(tel).balanceOf(to) - balBefore == xClaimed, "The plugin did not send appropriate token amount");

        // only emit Claimed if anything was actually claimed
        if (xClaimed > 0) {
            emit Claimed(account, xClaimed);
        }

        return xClaimed;
    }

    /// @notice Claims earned yield
    /// @param account Account to claim on behalf of.
    /// @param to Address to send the claimed yield to.
    /// @param auxData Auxiliary data for the plugins
    /// @dev Iterates over all plugins and calls `claim`
    /// @dev Checks to make sure the amount of tokens the plugins sent matches what the `claim` functions returned.
    /// @dev If amount claimed is >0, emit Claimed
    /// @return Amount claimed
    function _claim(address account, address to, bytes calldata auxData) private returns (uint256) {
        // balance of `to` before claiming
        uint256 balBefore = IERC20Upgradeable(tel).balanceOf(to);

        // call claim on all plugins and count the total amount claimed
        uint256 total;
        for (uint256 i = 0; i < nPlugins; i++) {
            total += IPlugin(plugins[i]).claim(account, to, auxData);
        }

        // make sure `total` actually matches how much we've claimed
        require(IERC20Upgradeable(tel).balanceOf(to) - balBefore == total, "one or more plugins did not send appropriate token amount");

        // only emit Claimed if anything was actually claimed
        if (total > 0) {
            emit Claimed(account, total);
        }

        return total;
    }

    /// @notice Withdraws staked TEL to the specified `to` address, does not claim any yield.
    /// @dev Notifies all plugins that account's stake is changing.
    /// @dev Writes _stakes checkpoint. 
    /// @dev Decrements _totalStaked
    /// @dev Transfers TEL
    /// @dev Emits StakeChanged.
    /// @param account Account to exit on behalf of.
    /// @param to Address to send the withdrawn balance to.
    /// @return Amount withdrawn
    function _exit(address account, address to) private returns (uint256) {
        uint256 amt = _stakes[account].latest();

        if (amt == 0) {
            return 0;
        }

        // notify plugins
        _notifyStakeChangeAllPlugins(account, amt, 0);

        // update checkpoints
        _stakes[account].push(0);

        // update _totalStaked
        _totalStaked -= amt;

        // move the tokens
        IERC20Upgradeable(tel).safeTransfer(to, amt);

        emit StakeChanged(account, amt, 0);

        return amt;
    }

    /// @notice Stakes some amount of TEL to earn potential rewards.
    /// @dev Notifies all plugins that account's stake is changing.
    /// @dev Updates _stakes[account]
    /// @dev Increments _totalStaked
    /// @dev Transfers TEL
    /// @dev Emits StakeChanged.
    /// @param account Account to stake on behalf of
    /// @param from Address to pull TEL from
    /// @param amount Amount to stake
    function _stake(address account, address from, uint256 amount) private {
        require(amount > 0, "Cannot stake 0");

        uint256 stakedBefore = _stakes[account].latest();
        uint256 stakedAfter = stakedBefore + amount;

        // notify plugins
        _notifyStakeChangeAllPlugins(account, stakedBefore, stakedAfter);
        
        // update _stakes
        _stakes[account].push(stakedAfter);

        // update _totalStaked
        _totalStaked += amount;

        // move the tokens
        IERC20Upgradeable(tel).safeTransferFrom(from, address(this), amount);

        emit StakeChanged(account, stakedBefore, stakedAfter);
    }

    /// @notice Claims yield and withdraws some of stake. Everything leftover remains staked
    /// @param account account
    /// @param amount amount to withdraw
    /// @param to account to send withdrawn funds to
    /// @dev The yield of the account is claimed to this contract
    /// @dev Call `notifyStakeChange` on all plugins
    /// @dev Update _stakes[account]
    /// @dev Update _totalStaked
    /// @dev Transfer `amount` of tokens to `to`
    /// @dev Emit StakeChanged
    function _claimAndExit(address account, uint256 amount, address to, bytes calldata auxData) private {
        require(amount <= balanceOf(account, auxData), "Account has insufficient balance");

        // keep track of initial stake
        uint256 oldStake = _stakes[account].latest();
        // xClaimed = total amount claimed
        uint256 xClaimed = _claim(account, address(this), auxData);

        uint256 newStake = oldStake + xClaimed - amount;

        // notify all plugins that account's stake has changed (if the plugin requires)
        _notifyStakeChangeAllPlugins(account, oldStake, newStake);

        // update _stakes
        _stakes[account].push(newStake);

        // decrement _totalStaked
        _totalStaked = _totalStaked - oldStake + newStake;

        // transfer the tokens to `to`
        IERC20Upgradeable(tel).safeTransfer(to, amount);

        emit StakeChanged(account, oldStake, newStake);
    }

    /// @dev Calls `notifyStakeChange` on all plugins that require it. This is done in case any given plugin needs to do some stuff when a user exits.
    /// @param account Account that is exiting
    function _notifyStakeChangeAllPlugins(address account, uint256 amountBefore, uint256 amountAfter) private {
        // loop over all plugins
        for (uint256 i = 0; i < nPlugins; i++) {
            // only notify if the plugin requires
            // if (IPlugin(plugins[i]).requiresNotification()) {
                IPlugin(plugins[i]).notifyStakeChange(account, amountBefore, amountAfter);
            // }
        }
    }


    /************************************************
    *   restricted functions
    ************************************************/

    /// @notice Slashes stake of an account.
    /// @notice Only those holding the `SLASHER_ROLE` may call this.
    /// @param account account to slash
    /// @param amount amount to slash
    /// @param to account to send slashed funds to
    function slash(address account, uint amount, address to, bytes calldata auxData) external onlyRole(SLASHER_ROLE) nonReentrant {
        _claimAndExit(account, amount, to, auxData);
        emit Slashed(account, amount);
    }

    /// @notice Adds a new plugin
    function addPlugin(address plugin) external onlyRole(PLUGIN_EDITOR_ROLE) {
        require(!pluginsMapping[plugin], "StakingModule::addPlugin: Cannot add an existing plugin");

        plugins.push(plugin);
        pluginsMapping[plugin] = true;
        nPlugins++;

        emit PluginAdded(plugin, nPlugins);
    }

    /// @notice Removes a plugin
    function removePlugin(uint256 index) external onlyRole(PLUGIN_EDITOR_ROLE) {
        address plugin = plugins[index];

        pluginsMapping[plugin] = false;
        plugins[index] = plugins[nPlugins - 1];
        plugins.pop();
        nPlugins--;

        emit PluginRemoved(plugin, nPlugins);
    }

    /// @notice Pause all unrestricted external functions
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause all unrestricted external functions
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice rescues any stuck erc20
    /// @dev if the token is TEL, then it only allows maximum of balanceOf(this) - _totalStaked to be rescued
    function rescueTokens(IERC20Upgradeable token, address to) external onlyRole(RECOVERY_ROLE) {
        if (address(token) == tel) {
            // if the token is TEL, only remove the extra amount that isn't staked
            token.safeTransfer(to, token.balanceOf(address(this)) - _totalStaked);
        }
        else {
            // if the token isn't TEL, remove all of it
            token.safeTransfer(to, token.balanceOf(address(this)));
        }
    }

    /// @notice claim and exit on behalf of a user
    /// @dev This function is in case of a token migration
    /// @dev We know this would be insanely gas intensive if there are a lot of users
    function claimAndExitFor(address account, address to, bytes calldata auxData) external onlyRole(RECOVERY_ROLE) whenPaused nonReentrant returns (uint256, uint256) {
        return (_claim(account, to, auxData), _exit(account, to));
    }

    /// @notice stake on behalf of a user
    /// @dev This function is in case of a token migration
    /// @dev We know this would be insanely gas intensive if there are a lot of users
    function stakeFor(address account, uint256 amount) external onlyRole(RECOVERY_ROLE) whenPaused nonReentrant {
        _stake(account, msg.sender, amount);
    }
}
