// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Context.sol";

/**
 * @dev Implements Openzeppelin Audited Contracts
 * @dev Contract module a sole executor responsible for adding and removing owners
 * @dev Contract module which provides a basic access control mechanism, where
 * there is a variable number of accounts (owners) that can be granted exclusive access to
 * specific functions.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owners.
 */
abstract contract TieredOwnership is Context {
    address private _executor;
    address private _nominatedExecutor;
    mapping (address => bool) private _owners;

    event ExecutorNominated(address indexed newExecutor);
    event ExecutorChanged(address indexed oldExecutor, address indexed newExecutor);
    event OwnershipAdded(address indexed newOwner);
    event OwnershipRemoved(address indexed oldOwner);

    /**
     * @dev Initializes the contract setting the deployer as the executor
     *
     * Emits a {ExecutorChanged} event.
     */
    constructor() {
        _executor = _msgSender();
        emit ExecutorChanged(address(0), _executor);
    }

    /**
     * @dev Returns the address of the current executor.
     */
    function executor() public view virtual returns (address) {
        return _executor;
    }

    /**
     * @dev Throws if called by any account other than the executor.
     */
    modifier onlyExecutor() {
        require(executor() == _msgSender(), "TieredOwnership: caller is not an executor");
        _;
    }

    /**
     * @dev Returns the address of the currently nominated executor.
     */
    function nominatedExecutor() public view virtual returns (address) {
        return _nominatedExecutor;
    }

    /**
     * @notice nominates address as new executor
     * @param newExecutor address is the new address being given executorship
     *
     * Emits a {ExecutorNominated} event.
     */
    function nominateExecutor(address newExecutor) external onlyExecutor() {
        _nominatedExecutor = newExecutor;
        emit ExecutorNominated(_nominatedExecutor);
    }

    /**
     * @notice promotes nominated executor to executor
     *
     * Emits a {ExecutorChanged} event.
     */
    function acceptExecutorship() external {
        require(_msgSender() == nominatedExecutor(), "TieredOwnership: You must be nominated before you can accept executorship");
        emit ExecutorChanged(executor(), nominatedExecutor());
        _executor = nominatedExecutor();
        _nominatedExecutor = address(0);
    }

    /**
     * @dev Returns true if address is owner
     * @param owner address of possible owner
     */
    function isOwner(address owner) public view virtual returns (bool) {
        return _owners[owner];
    }

    /**
     * @dev Throws if called by any account other than one of the owners.
     */
    modifier onlyOwner() {
        require(isOwner(_msgSender()) == true, "TieredOwnership: caller is not an owner");
        _;
    }

    /**
    * @notice adds additional owner
    * @param newOwner address is the new address being given ownership
    *
    * Emits a {OwnershipAdded} event.
    */
    function addOwner(address newOwner) public virtual onlyExecutor() {
        _owners[newOwner] = true;
        emit OwnershipAdded(newOwner);
    }


    /**
     * @dev removes an owner.
     * @param oldOwner address is the owner to be removed
     */
    function removeOwner(address oldOwner) public virtual onlyExecutor() {
        _owners[oldOwner] = false;
        emit OwnershipRemoved(oldOwner);
    }
}