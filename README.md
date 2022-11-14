# Telcoin contest details

- 10,000 USDC main award pot
- Join [Sherlock Discord](https://discord.gg/MABEWyASkp)
- Submit findings using the issue page in your private contest repo (label issues as med or high)
- [Read for more details](https://docs.sherlock.xyz/audits/watsons)
- Starts November 17, 2022 15:00 UTC
- Ends November 20, 2022 15:00 UTC

# Resources

- [Website](https://www.telco.in/)
- [Twitter](https://twitter.com/telcoin)
- [Medium](https://telcoin.medium.com/)

# On-chain context
DEPLOYMENT: `Polygon`
ERC20: [`Token List`](https://tokenlists.org/token-list?url=https://raw.githubusercontent.com/telcoin/token-lists/master/telcoins.json)
-This is a list of supported tokens by the Telcoin platform. In order to perform trades, users will create approvals from their wallet to the 1 inch aggregator to perform swaps
ADMIN:
Trusted authories
-1 inch aggregator
-The addresses intended to be owners of any contract can be viewed as a trusted. Here is a list of associated positions. If a means of adding one of these roles is compromised. This would be an attack surface.
--TieredOwnership: Executor
--TieredOwnership: Owner(s)
--Ownable: Owner
--AccessControlEnumerableUpgradeable: DEFAULT_ADMIN_ROLE
--AccessControlEnumerableUpgradeable: SLASHER_ROLE
--AccessControlEnumerableUpgradeable: PLUGIN_EDITOR_ROLE
--AccessControlEnumerableUpgradeable: PAUSER_ROLE
--AccessControlEnumerableUpgradeable: RECOVERY_ROLE

# Audit scope
```
contracts/interfaces/IPlugin.sol
contracts/StakingModule.sol
contracts/libraries/AuxDataLib.sol
contracts/SimplePlugin.sol
contracts/feebuyback/IFeeBuyback.sol
contracts/feebuyback/TieredOwnership.sol
contracts/feebuyback/ISimplePlugin.sol
contracts/feebuyback/FeeBuyback.sol
```

# About Telcoin
Telcoin leverages blockchain technology to provide access to low-cost, high-quality decentralized financial products for every mobile phone user in the world.

# TEL Staking
The staking design involves two main components: the `StakingModule` and `IPlugin`'s.

The `contracts/StakingModule.sol` contract is what users directly interact with and holds users' stakes. 
It exposes mutative methods such as `stake`, `claim` and `exit` as well as view methods such as `balanceOf` and `stakedBy`. 
The `StakingModule` is behind a Transparent Proxy to make it upgradable. 

To actually accrue yield, one or more `IPlugin` contracts are 'connected' to the staking module. 
These contracts are responsible for accruing/generating yield for stakers, which the `StakingModule` pulls from. 

The separation of the `StakingModule` and its `IPlugin`s allows for different types of yield to be added and removed from staking while not requiring the `StakingModule` to be upgraded. 

In addition to the normal staking functions called by users, the `StakingModule` has some other functions that can be called by administrative roles. 
These include: `slash`, `addPlugin`, `removePlugin`, `pause` and `unpause`.

Currently there is only one `IPlugin` contract implemented, which is `SimplePlugin`. 
`SimplePlugin` is the simplest plugin possible, it has a designated address that can increase the rewards of an individual account by calling `increaseClaimableBy`. 

The `SimplePlugin`'s `increaser` (the address that is allowed to increase the rewards of an account) will be the `FeeBuyback` contract. The `FeeBuyback` contract executes swaps on behalf of a user's smart contract wallet, takes a portion of the trading fee, buys TEL with it, and gives it to another account via the `SimplePlugin`.

There is a single function on `FeeBuyback` called `submit`. This allows an EOA to perform two swaps in the same function, and then provides the resulting Telcoin from the second swap to the `SimplePlugin` as a reward for the referrer for the user performing the swap. The order of events for the buy-back contract is:
1. Provide the user's wallet with the payload necessary to perform their swap.
2. If there is no referral content provided, successfully exit.
3. If the user paid their fee in TEL, there is no need to perform a swap. Get TEL from safe and provide a reward to staking plugin, successfully exit.
4. If the user paid their fee in a currency that is an ERC20 token, create an allowance for the aggregator to perform a swap and retrieve tokens from the safe.
5. Perform the secondary swap and provide a reward to staking plugin, successfully exit.

## Versions
npm: `8.19.2`
node: `18.10.0`
hardhat: `2.8.4`
yarn: `1.22.19`

## Running Tests
`yarn install`

`npx hardhat test` or `npx hardhat coverage`

## Diagram
(For UML diagram generated by `sol2uml` check [`diagrams/uml.svg`](./diagrams/uml.svg))
![](./diagrams/flow.svg)

The [`composition diagram(diagrams/composition.svg)`](./diagrams/composition.svg) is a high level layout of all the separate data payloads and how they are organized, and which contracts they are executed in. `walletData` is outside the scope of this audit and is left here for completeness. The [`fbbUML diagram`](./diagrams/fbbUML.svg)) represents the relationship between different smart contracts. The 1 inch Aggregator is a smart contract responsible for receiving a payload and executing multilevel swap calls for the purpose of receiving the best possible returns. Its behavior is outside the control of Telcoin, and therefore outside the scope of this audit as well. 
