import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect, assert } from "chai";
import { BigNumber, Bytes, ContractTransaction } from "ethers";
import { ethers, upgrades } from "hardhat";
import { StakingModule, TEL } from "../../typechain";
import { mine, getLatestBlockNumber, generateNRandomAddresses } from "../helpers";

const emptyBytes: Bytes = [];

describe("StakingModule", () => {
    let deployer: SignerWithAddress;
    let slasher: SignerWithAddress;
    let pluginEditor: SignerWithAddress;
    let pauser: SignerWithAddress;
    let bob: SignerWithAddress;
    let charlie: SignerWithAddress;
    let slashCollector: SignerWithAddress;
    let recoveryRoleHolder: SignerWithAddress;

    let telContract: TEL;
    let stakingContract: StakingModule;

    let DEFAULT_ADMIN: string;
    let SLASHER_ROLE: string;
    let PLUGIN_EDITOR_ROLE: string;
    let PAUSER_ROLE: string;
    let RECOVERY_ROLE: string;

    const telTotalSupply = ethers.BigNumber.from(1e18+'');


    beforeEach('setup', async () => {
        [deployer, slasher, pluginEditor, pauser, bob, charlie, slashCollector, recoveryRoleHolder] = await ethers.getSigners();

        const TELFactory = await ethers.getContractFactory("TEL", deployer);
        const StakingModuleFactory = await ethers.getContractFactory("StakingModule", deployer);

        telContract = await TELFactory.deploy("Telcoin", "TEL");
        await telContract.deployed();

        stakingContract = await upgrades.deployProxy(StakingModuleFactory, [telContract.address]) as StakingModule;
        await stakingContract.deployed();

        expect(await telContract.balanceOf(deployer.address)).to.equal(telTotalSupply);
        expect(await stakingContract.tel()).to.equal(telContract.address);

        DEFAULT_ADMIN = await stakingContract.DEFAULT_ADMIN_ROLE();
        SLASHER_ROLE = await stakingContract.SLASHER_ROLE();
        PLUGIN_EDITOR_ROLE = await stakingContract.PLUGIN_EDITOR_ROLE();
        PAUSER_ROLE = await stakingContract.PAUSER_ROLE();
        RECOVERY_ROLE = await stakingContract.RECOVERY_ROLE();
    });
    
    describe("roles", () => {
        describe("DEFAULT_ADMIN", () => {
            it("should be only deployer address", async () => {
                expect((await stakingContract.getRoleMemberCount(DEFAULT_ADMIN))).to.equal(1);
                expect(await stakingContract.getRoleMember(DEFAULT_ADMIN, 0)).to.equal(deployer.address);
            });

            it("should not be changeable by non admin", async () => {
                await expect(stakingContract.connect(bob).grantRole(DEFAULT_ADMIN, bob.address)).to.be.revertedWith("AccessControl:");
            });
            
            it("should be transferrable", async () => {
                await stakingContract.connect(deployer).grantRole(DEFAULT_ADMIN, bob.address);
                expect((await stakingContract.getRoleMemberCount(DEFAULT_ADMIN))).to.equal(2);
                
                await stakingContract.connect(deployer).revokeRole(DEFAULT_ADMIN, deployer.address);

                expect(await stakingContract.hasRole(DEFAULT_ADMIN, bob.address)).to.be.true;
                expect(await stakingContract.hasRole(DEFAULT_ADMIN, deployer.address)).to.be.false;
            });
        });

        describe("SLASHER_ROLE/PLUGIN_EDITOR_ROLE/PAUSER_ROLE", () => {
            it("should have no members", async () => {
                expect((await stakingContract.getRoleMemberCount(SLASHER_ROLE))).to.equal(0);
                expect((await stakingContract.getRoleMemberCount(PLUGIN_EDITOR_ROLE))).to.equal(0);
                expect((await stakingContract.getRoleMemberCount(PAUSER_ROLE))).to.equal(0);
            });

            describe("when granted by non admin", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(bob).grantRole(SLASHER_ROLE, bob.address)).to.be.revertedWith("AccessControl:");
                    await expect(stakingContract.connect(bob).grantRole(PLUGIN_EDITOR_ROLE, bob.address)).to.be.revertedWith("AccessControl:");
                    await expect(stakingContract.connect(bob).grantRole(PAUSER_ROLE, bob.address)).to.be.revertedWith("AccessControl:");
                });
            });

            describe("when granted by admin", () => {
                beforeEach(async () => {
                    await stakingContract.connect(deployer).grantRole(SLASHER_ROLE, slasher.address);
                    await stakingContract.connect(deployer).grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address);
                    await stakingContract.connect(deployer).grantRole(PAUSER_ROLE, pauser.address);
                });

                it("should set role", async () => {
                    expect((await stakingContract.getRoleMemberCount(SLASHER_ROLE))).to.equal(1);
                    expect((await stakingContract.getRoleMemberCount(PLUGIN_EDITOR_ROLE))).to.equal(1);
                    expect((await stakingContract.getRoleMemberCount(PAUSER_ROLE))).to.equal(1);

                    expect(await stakingContract.hasRole(SLASHER_ROLE, slasher.address)).to.be.true;
                    expect(await stakingContract.hasRole(PLUGIN_EDITOR_ROLE, pluginEditor.address)).to.be.true;
                    expect(await stakingContract.hasRole(PAUSER_ROLE, pauser.address)).to.be.true;
                });

                describe("when a member tries to edit their own role", () => {
                    it("should fail", async () => {
                        await expect(stakingContract.connect(slasher).grantRole(SLASHER_ROLE, bob.address)).to.be.revertedWith("AccessControl:");
                        await expect(stakingContract.connect(pluginEditor).grantRole(PLUGIN_EDITOR_ROLE, bob.address)).to.be.revertedWith("AccessControl:");
                        await expect(stakingContract.connect(pauser).grantRole(PAUSER_ROLE, bob.address)).to.be.revertedWith("AccessControl:");
                    });
                });
            });
        });
    });


    describe("staking", () => {
        const bobInitialBalance = 100;
        const bobAmtStake = 10;
        const charlieInitialBalance = 200;
        const charlieAmtStake = 23;

        beforeEach(async () => {
            await telContract.connect(deployer).transfer(bob.address, bobInitialBalance);
            expect(await telContract.balanceOf(bob.address)).to.equal(bobInitialBalance);

            await telContract.connect(deployer).transfer(charlie.address, charlieInitialBalance);
            expect(await telContract.balanceOf(charlie.address)).to.equal(charlieInitialBalance);
        });

        describe('when not approved', () => {
            it('should fail', async () => {
                await expect(stakingContract.connect(bob).stake(bobAmtStake)).to.be.reverted;
            });
        });

        describe('when staking amount is more than balance', () => {
            it('should fail', async () => {
                await telContract.connect(bob).approve(stakingContract.address, ethers.constants.MaxUint256);
                await expect(stakingContract.connect(bob).stake(bobInitialBalance + 1)).to.be.reverted;
            });
        });

        describe('when staking amount is 0', () => {
            it('should fail', async () => {
                await telContract.connect(bob).approve(stakingContract.address, ethers.constants.MaxUint256);
                await expect(stakingContract.connect(bob).stake(0)).to.be.reverted;
            });
        });

        describe('when bob, charlie, bob successfully stake', () => {
            let bobStakeBlock1: number;
            let bobStakeTx1: ContractTransaction;
            let charlieStakeBlock2: number;
            let charlieStakeTx2: ContractTransaction;
            let bobStakeBlock3: number;
            let bobStakeTx3: ContractTransaction;
            const blocksToMine = 10;

            beforeEach(async () => {
                await telContract.connect(bob).approve(stakingContract.address, ethers.constants.MaxUint256);
                await telContract.connect(charlie).approve(stakingContract.address, ethers.constants.MaxUint256);
                
                bobStakeTx1 = await stakingContract.connect(bob).stake(bobAmtStake);
                bobStakeBlock1 = bobStakeTx1.blockNumber || -1;
                assert(bobStakeBlock1 != -1);

                await mine(blocksToMine);

                charlieStakeTx2 = await stakingContract.connect(charlie).stake(charlieAmtStake);
                charlieStakeBlock2 = charlieStakeTx2.blockNumber || -1;
                assert(bobStakeBlock1 != -1);

                await mine(blocksToMine);

                bobStakeTx3 = await stakingContract.connect(bob).stake(bobAmtStake);
                bobStakeBlock3 = bobStakeTx3.blockNumber || -1;
                assert(bobStakeBlock3 != -1);

                await mine(blocksToMine);
            });
            
            it('should emit StakeChanged', async () => {
                expect(bobStakeTx1).to.emit(stakingContract, "StakeChanged");
                expect(charlieStakeTx2).to.emit(stakingContract, "StakeChanged");
                expect(bobStakeTx3).to.emit(stakingContract, "StakeChanged");

                expect(bobStakeTx1).to.emit(telContract, "Transfer");
                expect(charlieStakeTx2).to.emit(telContract, "Transfer");
                expect(bobStakeTx3).to.emit(telContract, "Transfer");
            });

            it('should increase TEL balance of StakingModule', async () => {
                expect(await telContract.balanceOf(stakingContract.address)).to.equal(2*bobAmtStake + charlieAmtStake);
            })
            
            it('should increase balanceOf(bob)', async () => {
                expect(await stakingContract.balanceOf(bob.address, emptyBytes)).to.equal(2*bobAmtStake);
            });

            it('should increase stakedBy(bob)', async () => {
                expect(await stakingContract.stakedBy(bob.address)).to.equal(2*bobAmtStake);
            });

            it('should increase totalStaked()', async () => {
                expect(await stakingContract.totalStaked()).to.equal(2*bobAmtStake + charlieAmtStake);
            });

            it('should increase totalSupply()', async () => {
                expect(await stakingContract.totalSupply()).to.equal(2*bobAmtStake + charlieAmtStake);
            });

            it('should create checkpoints before, at, and after both stake', async () => {
                expect(await stakingContract.stakedByAt(bob.address, bobStakeBlock1 - 1)).to.equal(0);
                expect(await stakingContract.stakedByAt(bob.address, bobStakeBlock1)).to.equal(bobAmtStake);
                expect(await stakingContract.stakedByAt(bob.address, bobStakeBlock1 + 1)).to.equal(bobAmtStake);

                expect(await stakingContract.balanceOfAt(bob.address, bobStakeBlock1 - 1, "0x")).to.equal(0);
                expect(await stakingContract.balanceOfAt(bob.address, bobStakeBlock1, "0x")).to.equal(bobAmtStake);
                expect(await stakingContract.balanceOfAt(bob.address, bobStakeBlock1 + 1, "0x")).to.equal(bobAmtStake);

                expect(await stakingContract.stakedByAt(charlie.address, charlieStakeBlock2 - 1)).to.equal(0);
                expect(await stakingContract.stakedByAt(charlie.address, charlieStakeBlock2)).to.equal(charlieAmtStake);
                expect(await stakingContract.stakedByAt(charlie.address, charlieStakeBlock2 + 1)).to.equal(charlieAmtStake);

                expect(await stakingContract.balanceOfAt(charlie.address, charlieStakeBlock2 - 1, "0x")).to.equal(0);
                expect(await stakingContract.balanceOfAt(charlie.address, charlieStakeBlock2, "0x")).to.equal(charlieAmtStake);
                expect(await stakingContract.balanceOfAt(charlie.address, charlieStakeBlock2 + 1, "0x")).to.equal(charlieAmtStake);

                expect(await stakingContract.stakedByAt(bob.address, bobStakeBlock3 - 1)).to.equal(bobAmtStake);
                expect(await stakingContract.stakedByAt(bob.address, bobStakeBlock3)).to.equal(2*bobAmtStake);
                expect(await stakingContract.stakedByAt(bob.address, bobStakeBlock3 + 1)).to.equal(2*bobAmtStake);

                expect(await stakingContract.balanceOfAt(bob.address, bobStakeBlock3 - 1, "0x")).to.equal(bobAmtStake);
                expect(await stakingContract.balanceOfAt(bob.address, bobStakeBlock3, "0x")).to.equal(2*bobAmtStake);
                expect(await stakingContract.balanceOfAt(bob.address, bobStakeBlock3 + 1, "0x")).to.equal(2*bobAmtStake);
            });

            it('should fail to get checkpoint in the future', async () => {
                await expect(stakingContract.stakedByAt(bob.address, await getLatestBlockNumber())).to.be.reverted;
                await expect(stakingContract.balanceOfAt(bob.address, await getLatestBlockNumber(), "0x")).to.be.reverted;
            });
        });
    });

    describe("claim", () => {
        describe("when no yield", () => {
            let claimTx: ContractTransaction;

            beforeEach(async () => {
                claimTx = await stakingContract.connect(bob).claim(emptyBytes);
            });

            it('should do nothing', async () => {
                expect(claimTx).to.not.emit(stakingContract, "Claimed");
                expect(claimTx).to.not.emit(telContract, "Transfer");
            });
        });
    });

    describe("claimFromIndividualPlugin", () => {
        it("should fail because there are no plugins", async () => {
            await expect(stakingContract.connect(bob).claimFromIndividualPlugin(0, emptyBytes)).to.be.revertedWith("StakingModule::_claimFromIndividualPlugin: Provided pluginIndex is out of bounds");
        });
    });

    describe("exit", () => {
        describe("when nothing is staked", () => {
            let exitTx: ContractTransaction;

            beforeEach(async () => {
                exitTx = await stakingContract.connect(bob).exit();
            });

            it('should do nothing', async () => {
                expect(exitTx).to.not.emit(stakingContract, "StakeChanged");
                expect(exitTx).to.not.emit(telContract, "Transfer");
            });
        });

        describe("when something is staked", () => {
            let stakeBlock: number;
            let stakeTx: ContractTransaction;
            let exitBlock: number;
            let exitTx: ContractTransaction;

            const blocksToMine = 10;

            const bobInitialBalance = 100;
            const bobAmtStake = 10;

            const charlieInitialBalance = 200;
            const charlieAmtStake = 23;

            beforeEach(async () => {
                await telContract.connect(deployer).transfer(bob.address, bobInitialBalance);
                await telContract.connect(bob).approve(stakingContract.address, ethers.constants.MaxUint256);
                
                await telContract.connect(deployer).transfer(charlie.address, charlieInitialBalance);
                await telContract.connect(charlie).approve(stakingContract.address, ethers.constants.MaxUint256);

                await stakingContract.connect(charlie).stake(charlieAmtStake);

                stakeTx = await stakingContract.connect(bob).stake(bobAmtStake);
                stakeBlock = stakeTx.blockNumber || -1;
                assert(stakeBlock != -1);

                await mine(blocksToMine);

                exitTx = await stakingContract.connect(bob).exit();
                exitBlock = exitTx.blockNumber || -1;
                assert(exitBlock != -1);

                await mine(blocksToMine);
            });

            it("should emit StakeChanged", async () => {
                expect(exitTx).to.emit(stakingContract, "StakeChanged");
            });

            it('should decrease TEL balance of StakingModule', async () => {
                expect(await telContract.balanceOf(stakingContract.address)).to.equal(charlieAmtStake);
            })
            
            it('should decrease balanceOf(bob)', async () => {
                expect(await stakingContract.balanceOf(bob.address, emptyBytes)).to.equal(0);
            });

            it('should decrease stakedBy(bob)', async () => {
                expect(await stakingContract.stakedBy(bob.address)).to.equal(0);
            });

            it('should decrease totalStaked()', async () => {
                expect(await stakingContract.totalStaked()).to.equal(charlieAmtStake);
            });

            it('should decrease totalSupply()', async () => {
                expect(await stakingContract.totalSupply()).to.equal(charlieAmtStake);
            });

            it('should create checkpoints before, at, and after both stake', async () => {
                expect(await stakingContract.stakedByAt(bob.address, exitBlock - 1)).to.equal(bobAmtStake);
                expect(await stakingContract.stakedByAt(bob.address, exitBlock)).to.equal(0);
                expect(await stakingContract.stakedByAt(bob.address, exitBlock + 1)).to.equal(0);

                expect(await stakingContract.balanceOfAt(bob.address, exitBlock - 1, "0x")).to.equal(bobAmtStake);
                expect(await stakingContract.balanceOfAt(bob.address, exitBlock, "0x")).to.equal(0);
                expect(await stakingContract.balanceOfAt(bob.address, exitBlock + 1, "0x")).to.equal(0);
            });
        });
    });

    describe("stakeFor", () => {
        // don't feel the need to test this too extensively
        const bobAmtStake = 50;

        beforeEach(async () => {
            await telContract.connect(deployer).transfer(recoveryRoleHolder.address, bobAmtStake);
            expect(await telContract.balanceOf(recoveryRoleHolder.address)).to.equal(bobAmtStake);

            await stakingContract.connect(deployer).grantRole(RECOVERY_ROLE, recoveryRoleHolder.address);

            await telContract.connect(recoveryRoleHolder).approve(stakingContract.address, ethers.constants.MaxUint256);
        });

        describe("when not paused", () => {
            it("should fail", async () => {
                await expect(stakingContract.connect(recoveryRoleHolder).stakeFor(bob.address, 1)).to.be.revertedWith("Pausable: not paused");
            });
        });

        describe("when paused", () => {
            beforeEach(async () => {
                await stakingContract.connect(deployer).grantRole(PAUSER_ROLE, pauser.address);
                await stakingContract.connect(pauser).pause();
            });

            describe("when called by non recovery role holder", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(deployer).stakeFor(bob.address, 1)).to.be.revertedWith("AccessControl:");
                });
            });

            describe("when called by recovery role holder", () => {
                let stakeTx: ContractTransaction;

                beforeEach(async () => {
                    await telContract.connect(recoveryRoleHolder).approve(stakingContract.address, ethers.constants.MaxUint256);             
                    stakeTx = await stakingContract.connect(recoveryRoleHolder).stakeFor(bob.address, bobAmtStake);                
                });

                it("should move tokens from Recover Role Holder to StakingModule", async () => {
                    expect(await telContract.balanceOf(stakingContract.address)).to.equal(bobAmtStake);
                    expect(await telContract.balanceOf(recoveryRoleHolder.address)).to.equal(0);                
                });

                it("should update balanceOf(Bob) and stakedBy(Bob)", async () => {
                    expect(await stakingContract.balanceOf(bob.address, "0x")).to.equal(bobAmtStake);
                    expect(await stakingContract.stakedBy(bob.address)).to.equal(bobAmtStake);
                });

                it("should emit StakeChanged", async () => {
                    expect(stakeTx).to.emit(stakingContract, "StakeChanged");
                });
            })
        });
    });

    describe("claimAndExitFor", () => {
        // don't feel the need to test this too extensively
        const bobAmtStake = 50;

        beforeEach(async () => {
            await telContract.connect(deployer).transfer(bob.address, bobAmtStake);
            expect(await telContract.balanceOf(bob.address)).to.equal(bobAmtStake);

            await telContract.connect(bob).approve(stakingContract.address, ethers.constants.MaxUint256);
            await stakingContract.connect(bob).stake(bobAmtStake);

            await stakingContract.connect(deployer).grantRole(RECOVERY_ROLE, recoveryRoleHolder.address);
        });

        describe("when not paused", () => {
            it("should fail", async () => {
                await expect(stakingContract.connect(recoveryRoleHolder).claimAndExitFor(bob.address, charlie.address, "0x")).to.be.revertedWith("Pausable: not paused");
            });
        });

        describe("when paused", () => {
            beforeEach(async () => {
                await stakingContract.connect(deployer).grantRole(PAUSER_ROLE, pauser.address);
                await stakingContract.connect(pauser).pause();
            });

            describe("when called by non recovery role holder", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(deployer).claimAndExitFor(bob.address, charlie.address, "0x")).to.be.revertedWith("AccessControl:");
                });
            });

            describe("when called by recovery role holder", () => {
                let stakeTx: ContractTransaction;

                beforeEach(async () => {
                    await telContract.connect(recoveryRoleHolder).approve(stakingContract.address, ethers.constants.MaxUint256);             
                    stakeTx = await stakingContract.connect(recoveryRoleHolder).claimAndExitFor(bob.address, charlie.address, "0x");                
                });

                it("should move tokens from StakingModule to Charlie", async () => {
                    expect(await telContract.balanceOf(charlie.address)).to.equal(bobAmtStake);
                    expect(await telContract.balanceOf(recoveryRoleHolder.address)).to.equal(0);                
                    expect(await telContract.balanceOf(stakingContract.address)).to.equal(0);                
                });

                it("should update balanceOf(Bob) and stakedBy(Bob)", async () => {
                    expect(await stakingContract.balanceOf(bob.address, "0x")).to.equal(0);
                    expect(await stakingContract.stakedBy(bob.address)).to.equal(0);
                });

                it("should emit StakeChanged", async () => {
                    expect(stakeTx).to.emit(stakingContract, "StakeChanged");
                });
            })
        });
    });

    describe("slash", () => {
        const charlieInitialBalance = 200;
        const charlieAmtStake = 23;

        beforeEach('make charlie stake and grant slasher role', async () => {
            await telContract.connect(deployer).transfer(charlie.address, charlieInitialBalance);
            await telContract.connect(charlie).approve(stakingContract.address, ethers.constants.MaxUint256);

            await stakingContract.connect(charlie).stake(charlieAmtStake);

            await stakingContract.connect(deployer).grantRole(SLASHER_ROLE, slasher.address);
        });

        describe("when called by non-slasher", () => {
            let slashTxPromise: Promise<ContractTransaction>;

            beforeEach(async () => {
                slashTxPromise = stakingContract.connect(deployer).slash(bob.address, 1, stakingContract.address, emptyBytes);
            });

            it("should fail", async () => {
                await expect(slashTxPromise).to.be.revertedWith("AccessControl:");
            });
        });

        describe("when called by slasher", () => {
            describe("when slashed user has no stake", () => {
                it("should fail", async () => {
                    let slashTxPromise = stakingContract.connect(slasher).slash(bob.address, 1, stakingContract.address, emptyBytes);

                    await expect(slashTxPromise).to.be.revertedWith('Account has insufficient balance');
                });
            });

            describe("when slashed user has some stake", () => {
                const bobInitialBalance = 100;
                const bobAmtStake = 20;

                beforeEach(async () => {
                    await telContract.connect(deployer).transfer(bob.address, bobInitialBalance);
                    await telContract.connect(bob).approve(stakingContract.address, ethers.constants.MaxUint256);
                    await stakingContract.connect(bob).stake(bobAmtStake);
                });

                describe("when slashed amount is too big", () => {
                    it("should fail", async () => {
                        await expect(stakingContract.connect(slasher).slash(bob.address, bobAmtStake + 1, slashCollector.address, emptyBytes)).to.be.revertedWith("Account has insufficient balance");
                    });
                });

                describe("when slashed amount is equal to staked amount", () => {
                    let slashTx: ContractTransaction;
                    beforeEach(async () => {
                        slashTx = await stakingContract.connect(slasher).slash(bob.address, bobAmtStake, slashCollector.address, emptyBytes);
                    });

                    it("should emit Slashed and StakeChanged", () => {
                        expect(slashTx).to.emit(stakingContract, "Slashed");
                        expect(slashTx).to.emit(stakingContract, "StakeChanged");
                    })

                    it("should leave slashCollector with tel", async () => {
                        expect(await telContract.balanceOf(slashCollector.address)).to.equal(bobAmtStake);
                    });

                    it("should leave stakingContract with only charlie's stake worth of tel", async () => {
                        expect(await telContract.balanceOf(stakingContract.address)).to.equal(charlieAmtStake);
                    });

                    it("balanceOf(bob), stakedBy(bob) should be 0", async () => {
                        expect(await stakingContract.balanceOf(bob.address, emptyBytes)).to.equal(0);
                        expect(await stakingContract.stakedBy(bob.address)).to.equal(0);
                    });
                });

                describe("when slashed amount is less than staked amount", () => {
                    let slashTx: ContractTransaction;
                    beforeEach(async () => {
                        slashTx = await stakingContract.connect(slasher).slash(bob.address, bobAmtStake - 1, slashCollector.address, emptyBytes);
                    });

                    it("should emit Slashed and StakeChanged", () => {
                        expect(slashTx).to.emit(stakingContract, "Slashed");
                        expect(slashTx).to.emit(stakingContract, "StakeChanged");
                    })

                    it("should leave slashCollector with tel", async () => {
                        expect(await telContract.balanceOf(slashCollector.address)).to.equal(bobAmtStake - 1);
                    });

                    it("should leave stakingContract with 1 + charlie's stake worth of tel", async () => {
                        expect(await telContract.balanceOf(stakingContract.address)).to.equal(1 + charlieAmtStake);
                    });

                    it("balanceOf(bob), stakedBy(bob) should be 1", async () => {
                        expect(await stakingContract.balanceOf(bob.address, emptyBytes)).to.equal(1);
                        expect(await stakingContract.stakedBy(bob.address)).to.equal(1);
                    });
                });
            });
        });
    });

    describe("addPlugin", () => {
        describe("when called by non-editor", () => {
            it("should fail", async () => {
                await expect(stakingContract.connect(deployer).addPlugin(charlie.address)).to.be.revertedWith("AccessControl:");
            });
        });

        describe("when called by editor", () => {
            const nPlugins = 3;
            const plugins = generateNRandomAddresses(3);
            const txs: ContractTransaction[] = [];

            beforeEach(async () => {
                await stakingContract.connect(deployer).grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address);

                for (let i = 0; i < nPlugins; i++) {
                    txs.push(await stakingContract.connect(pluginEditor).addPlugin(plugins[i]));
                }
            });

            it("should emit the correct events", async () => {
                for (let i = 0; i < nPlugins; i++) {
                    expect(txs[i]).to.emit(stakingContract, "PluginAdded");
                } 
            });

            it("should add the correct number of plugins", async () => {
                await expect(stakingContract.plugins(nPlugins - 1)).to.not.be.reverted;
                await expect(stakingContract.plugins(nPlugins)).to.be.reverted;

                expect(await stakingContract.nPlugins()).to.equal(nPlugins);
            })

            it("should add the right values for plugins", async () => {
                for (let i = 0; i < nPlugins; i++) {
                    expect(await stakingContract.plugins(i)).to.equal(plugins[i]);
                }
            });

            it("should update the plugins mapping", async () => {
                for (let i = 0; i < nPlugins; i++) {
                    expect(await stakingContract.pluginsMapping(plugins[i])).to.equal(true);
                }
            });

            describe("when adding a plugin that already exists", () => {
                let txPromise: Promise<ContractTransaction>;

                beforeEach(async () => {
                    txPromise = stakingContract.connect(pluginEditor).addPlugin(plugins[0]);
                });

                it("should fail", async () => {
                    await expect(txPromise).to.be.revertedWith("StakingModule::addPlugin: Cannot add an existing plugin");
                });
            });
        });
    });

    describe("removePlugin", () => {
        const nPlugins = 3;
        const plugins = generateNRandomAddresses(nPlugins);

        describe("when called by non-editor", () => {
            it("should fail", async () => {
                await expect(stakingContract.connect(deployer).removePlugin(charlie.address)).to.be.revertedWith("AccessControl:");
            });
        });

        describe("when called by editor", () => {
            beforeEach(async () => {
                await stakingContract.connect(deployer).grantRole(PLUGIN_EDITOR_ROLE, pluginEditor.address);
            });

            describe("when no plugins have been added", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(pluginEditor).removePlugin(0)).to.be.reverted;
                });
            });

            describe("when some plugins have been added", () => {
                beforeEach(async () => {
                    for (let i = 0; i < nPlugins; i++) {
                        await stakingContract.connect(pluginEditor).addPlugin(plugins[i]);
                    }
                });

                describe("when a plugin out of bounds is removed", () => {
                    it("should fail", async () => {
                        await expect(stakingContract.connect(pluginEditor).removePlugin(nPlugins)).to.be.reverted;
                    });
                });

                describe("when the first plugin is removed", () => {
                    beforeEach(async () => {
                        await stakingContract.connect(pluginEditor).removePlugin(0);
                    });

                    it("should remove exactly one plugin", async () => {
                        await expect(stakingContract.plugins(nPlugins - 2)).to.not.be.reverted;
                        await expect(stakingContract.plugins(nPlugins - 1)).to.be.reverted;

                        expect(await stakingContract.nPlugins()).to.equal(nPlugins - 1);
                    })

                    it("should remove the first one", async () => {
                        for (let i = 0; i < nPlugins - 1; i++) {
                            expect(await stakingContract.plugins(i)).to.not.equal(plugins[0]);
                        } 
                    });

                    it("should update the plugins mapping", async () => {
                        expect(await stakingContract.pluginsMapping(plugins[0])).to.equal(false);
                    });
                });

                describe("when the second plugin is removed", () => {
                    beforeEach(async () => {
                        await stakingContract.connect(pluginEditor).removePlugin(1);
                    });

                    it("should remove exactly one plugin", async () => {
                        await expect(stakingContract.plugins(nPlugins - 2)).to.not.be.reverted;
                        await expect(stakingContract.plugins(nPlugins - 1)).to.be.reverted;

                        expect(await stakingContract.nPlugins()).to.equal(nPlugins - 1);
                    })

                    it("should remove the second one", async () => {
                        for (let i = 0; i < nPlugins - 1; i++) {
                            expect(await stakingContract.plugins(i)).to.not.equal(plugins[1]);
                        } 
                    });

                    it("should update the plugins mapping", async () => {
                        expect(await stakingContract.pluginsMapping(plugins[1])).to.equal(false);
                    });
                });

                describe("when the last plugin is removed", () => {
                    beforeEach(async () => {
                        await stakingContract.connect(pluginEditor).removePlugin(nPlugins - 1);
                    });

                    it("should remove exactly one plugin", async () => {
                        await expect(stakingContract.plugins(nPlugins - 2)).to.not.be.reverted;
                        await expect(stakingContract.plugins(nPlugins - 1)).to.be.reverted;

                        expect(await stakingContract.nPlugins()).to.equal(nPlugins - 1);
                    })

                    it("should remove the last one", async () => {
                        for (let i = 0; i < nPlugins - 1; i++) {
                            expect(await stakingContract.plugins(i)).to.not.equal(plugins[nPlugins - 1]);
                        } 
                    });

                    it("should update the plugins mapping", async () => {
                        expect(await stakingContract.pluginsMapping(plugins[nPlugins - 1])).to.equal(false);
                    });
                });
            });
        });
    });

    describe("pause", () => {
        describe("when called by non-pauser", () => {
            it("should fail", async () => {
                await expect(stakingContract.connect(deployer).pause()).to.be.revertedWith("AccessControl:");
            });
        });

        describe("when called by pauser", () => {
            beforeEach(async () => {
                await stakingContract.grantRole(PAUSER_ROLE, pauser.address);
                await stakingContract.connect(pauser).pause();
            });

            it("should set paused = true", async () => {
                expect(await stakingContract.paused()).to.be.true;
            });

            describe("stake", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(deployer).stake(0)).to.be.revertedWith("Pausable: paused");
                });
            });

            describe("exit", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(deployer).exit()).to.be.revertedWith("Pausable: paused");
                });
            });

            describe("claim", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(deployer).claim(emptyBytes)).to.be.revertedWith("Pausable: paused");
                });
            });

            describe("fullClaimAndExit", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(deployer).fullClaimAndExit(emptyBytes)).to.be.revertedWith("Pausable: paused");
                });
            });

            describe("partialClaimAndExit", () => {
                it("should fail", async () => {
                    await expect(stakingContract.connect(deployer).partialClaimAndExit(1, emptyBytes)).to.be.revertedWith("Pausable: paused");
                });
            });

            describe("unpause", () => {
                beforeEach(async () => {
                    await stakingContract.connect(pauser).unpause();
                });

                it("should set paused = false", async () => {
                    expect(await stakingContract.paused()).to.be.false;
                });
            });
        });
    });

    describe("rescueTokens", () => {
        const bobAmtStake = 100;
        const extraTelAmt = 10;
        const extraOtherTokenAmt = 20;
        let otherTokenContract: TEL;

        beforeEach(async () => {
            // some user has stake
            await telContract.connect(deployer).transfer(bob.address, bobAmtStake);
            await telContract.connect(bob).approve(stakingContract.address, ethers.constants.MaxUint256);
            await stakingContract.connect(bob).stake(bobAmtStake);

            // send some extra TEL
            await telContract.connect(deployer).transfer(stakingContract.address, extraTelAmt);

            // send some non-TEL tokens
            const TELFactory = await ethers.getContractFactory("TEL", deployer);
            otherTokenContract = await TELFactory.deploy("Telcoin", "TEL");

            await otherTokenContract.connect(deployer).transfer(stakingContract.address, extraOtherTokenAmt);

            await stakingContract.connect(deployer).grantRole(await stakingContract.RECOVERY_ROLE(), recoveryRoleHolder.address);
        });

        describe("when called by non-recovery role", () => {
            it("should fail", async () => {
                await expect(stakingContract.connect(bob).rescueTokens(telContract.address, bob.address)).to.be.revertedWith("AccessControl:");
            });
        });

        describe("when called by recovery", () => {
            describe("when rescuing TEL", () => {
                it("should return ONLY the extra amount, not everything in the contract", async () => {
                    const balBefore = await telContract.balanceOf(charlie.address);
                    await stakingContract.connect(recoveryRoleHolder).rescueTokens(telContract.address, charlie.address);
                    const balAfter = await telContract.balanceOf(charlie.address);

                    expect(balAfter.sub(balBefore)).to.equal(extraTelAmt);
                    expect(await telContract.balanceOf(stakingContract.address)).to.equal(bobAmtStake);
                });
            });

            describe("when rescuing non-TEL", () => {
                it("should return entire balance of contract", async () => {
                    const balBefore = await otherTokenContract.balanceOf(charlie.address);
                    await stakingContract.connect(recoveryRoleHolder).rescueTokens(otherTokenContract.address, charlie.address);
                    const balAfter = await otherTokenContract.balanceOf(charlie.address);

                    expect(balAfter.sub(balBefore)).to.equal(extraOtherTokenAmt);
                    expect(await otherTokenContract.balanceOf(stakingContract.address)).to.equal(0);
                });
            });
        });
    });
});