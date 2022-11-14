import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect, assert } from "chai";
import { BigNumber, ContractTransaction, Bytes } from "ethers";
import { ethers, upgrades } from "hardhat";
import { SimplePlugin, StakingModule, TEL } from "../../typechain";
import { mine } from "../helpers";

// tests integration of SimplePlugin with StakingModule

const emptyBytes: Bytes = [];

describe("SimplePlugin integration", () => {
    let deployer: SignerWithAddress;
    let slasher: SignerWithAddress;
    let editor: SignerWithAddress;
    let bob: SignerWithAddress;
    let charlie: SignerWithAddress;
    let increaser: SignerWithAddress;
    
    let telContract: TEL;
    let stakingModule: StakingModule;
    let simplePlugin: SimplePlugin;

    let telTotalSupply: BigNumber;


    beforeEach('setup', async () => {
        [deployer, slasher, editor, bob, charlie, increaser] = await ethers.getSigners();

        const TELFactory = await ethers.getContractFactory("TEL", deployer);
        const SimplePluginFactory = await ethers.getContractFactory("SimplePlugin", deployer);
        const StakingModuleFactory = await ethers.getContractFactory("StakingModule", deployer);

        // deploy contracts
        telContract = await TELFactory.deploy("Telcoin", "TEL");
        await telContract.deployed();

        stakingModule = await upgrades.deployProxy(StakingModuleFactory, [telContract.address]) as StakingModule;
        await stakingModule.deployed();

        simplePlugin = await SimplePluginFactory.deploy(stakingModule.address);
        await simplePlugin.deployed();

        telTotalSupply = await telContract.totalSupply();

        // grant roles
        await stakingModule.connect(deployer).grantRole(await stakingModule.SLASHER_ROLE(), slasher.address);
        await stakingModule.connect(deployer).grantRole(await stakingModule.PLUGIN_EDITOR_ROLE(), editor.address);

        // add plugin
        await stakingModule.connect(editor).addPlugin(simplePlugin.address);
        
        // set up increaser account
        await telContract.connect(deployer).transfer(increaser.address, telTotalSupply);
        await simplePlugin.connect(deployer).setIncreaser(increaser.address);
        await telContract.connect(increaser).approve(simplePlugin.address, ethers.constants.MaxUint256);

        // preapprove bob for staking contract
        await telContract.connect(bob).approve(stakingModule.address, ethers.constants.MaxUint256);

        expect(await telContract.balanceOf(increaser.address)).to.equal(telTotalSupply);
    });


    describe("StakingModule::stake", () => {
        describe("when there is already yield owed to bob", () => {
            const bobInitialBalance = 100;
            const bobAmtStake = 20;
            const bobAmtToCredit = 50;

            let stakeTx: ContractTransaction;
            let stakeBlock: number;

            beforeEach(async () => {
                await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);

                await mine(10);
                
                await telContract.connect(increaser).transfer(bob.address, bobInitialBalance);
                
                stakeTx = await stakingModule.connect(bob).stake(bobAmtStake);
                stakeBlock = stakeTx.blockNumber || -1;

                assert(stakeBlock != -1);
            });

            it("should emit relevant events", async () => {
                expect(stakeTx).to.emit(stakingModule, "StakeChanged");
                // expect(stakeTx).to.emit(simplePlugin, "NotifyStake");
            });
            
            it('should increase TEL balance of StakingModule', async () => {
                expect(await telContract.balanceOf(stakingModule.address)).to.equal(bobAmtStake);
            })
            
            it('should increase balanceOf(bob)', async () => {
                expect(await stakingModule.balanceOf(bob.address, emptyBytes)).to.equal(bobAmtStake + bobAmtToCredit);
            });

            it('should increase stakedBy(bob)', async () => {
                expect(await stakingModule.stakedBy(bob.address)).to.equal(bobAmtStake);
            });

            it('should increase totalStaked()', async () => {
                expect(await stakingModule.totalStaked()).to.equal(bobAmtStake);
            });

            it('should increase totalSupply()', async () => {
                expect(await stakingModule.totalSupply()).to.equal(bobAmtStake + bobAmtToCredit);
            });

            it('should create checkpoints before, at, and after stake', async () => {
                await mine(10);

                expect(await stakingModule.stakedByAt(bob.address, stakeBlock - 1)).to.equal(0);
                expect(await stakingModule.stakedByAt(bob.address, stakeBlock)).to.equal(bobAmtStake);
                expect(await stakingModule.stakedByAt(bob.address, stakeBlock + 1)).to.equal(bobAmtStake);

                expect(await stakingModule.balanceOfAt(bob.address, stakeBlock - 1, "0x")).to.equal(bobAmtToCredit);
                expect(await stakingModule.balanceOfAt(bob.address, stakeBlock, "0x")).to.equal(bobAmtStake + bobAmtToCredit);
                expect(await stakingModule.balanceOfAt(bob.address, stakeBlock + 1, "0x")).to.equal(bobAmtStake + bobAmtToCredit);
            });
        });
    });

    describe("SimplePlugin::increaseClaimableBy", () => {
        const bobAmtStake = 90;
        const bobAmtToCredit = 50;
        let tx: ContractTransaction;
        let txBlock: number;

        describe("when the user is not staked", () => {
            beforeEach(async () => {
                tx = await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);
                txBlock = tx.blockNumber || -1;
                
                assert(txBlock != -1);
            });

            it("should increase StakingModule::totalSupply", async () => {
                expect(await stakingModule.totalSupply()).to.equal(bobAmtToCredit);
            });

            it("should increase StakingModule::claimable", async () => {
                expect(await stakingModule.claimable(bob.address, emptyBytes)).to.equal(bobAmtToCredit);
            });

            it("should increase StakingModule::balanceOf", async () => {
                expect(await stakingModule.balanceOf(bob.address, emptyBytes)).to.equal(bobAmtToCredit);
            });

            it("should create checkpoints for StakingModule::balanceOfAt(bob) and StakingModule::claimableAt(bob)", async () => {
                await mine(10);

                expect(await stakingModule.claimableAt(bob.address, txBlock - 1, "0x")).to.equal(0);
                expect(await stakingModule.claimableAt(bob.address, txBlock, "0x")).to.equal(bobAmtToCredit);
                expect(await stakingModule.claimableAt(bob.address, txBlock + 1, "0x")).to.equal(bobAmtToCredit);

                expect(await stakingModule.balanceOfAt(bob.address, txBlock - 1, "0x")).to.equal(0);
                expect(await stakingModule.balanceOfAt(bob.address, txBlock, "0x")).to.equal(bobAmtToCredit);
                expect(await stakingModule.balanceOfAt(bob.address, txBlock + 1, "0x")).to.equal(bobAmtToCredit);
            });
        });

        describe("when the user IS staked", () => {
            beforeEach(async () => {
                await telContract.connect(increaser).transfer(bob.address, bobAmtStake);
         
                await stakingModule.connect(bob).stake(bobAmtStake);

                await mine(10);

                tx = await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);
                txBlock = tx.blockNumber || -1;
                
                assert(txBlock != -1);
            });

            it("should increase StakingModule::totalSupply", async () => {
                expect(await stakingModule.totalSupply()).to.equal(bobAmtToCredit + bobAmtStake);
            });

            it("should increase StakingModule::claimable", async () => {
                expect(await stakingModule.claimable(bob.address, emptyBytes)).to.equal(bobAmtToCredit);
            });

            it("should increase StakingModule::balanceOf", async () => {
                expect(await stakingModule.balanceOf(bob.address, emptyBytes)).to.equal(bobAmtToCredit + bobAmtStake);
            });

            it("should create checkpoints for StakingModule::balanceOfAt(bob) and StakingModule::claimableAt(bob)", async () => {
                await mine(10);

                expect(await stakingModule.claimableAt(bob.address, txBlock - 1, "0x")).to.equal(0);
                expect(await stakingModule.claimableAt(bob.address, txBlock, "0x")).to.equal(bobAmtToCredit);
                expect(await stakingModule.claimableAt(bob.address, txBlock + 1, "0x")).to.equal(bobAmtToCredit);

                expect(await stakingModule.balanceOfAt(bob.address, txBlock - 1, "0x")).to.equal(bobAmtStake);
                expect(await stakingModule.balanceOfAt(bob.address, txBlock, "0x")).to.equal(bobAmtToCredit + bobAmtStake);
                expect(await stakingModule.balanceOfAt(bob.address, txBlock + 1, "0x")).to.equal(bobAmtToCredit + bobAmtStake);
            });
        })
    });


    describe("StakingModule::claim", () => {
        describe("when there is nothing to claim", () => {
            it('should do nothing', async () => {
                const claimTx = await stakingModule.connect(bob).claim(emptyBytes);

                expect(claimTx).to.not.emit(stakingModule, "Claimed");
                expect(claimTx).to.not.emit(simplePlugin, "Claimed");
                expect(claimTx).to.not.emit(telContract, "Transfer");
            });
        });

        describe("when user does not stake at all", () => {
            const bobAmtToCredit = 50;

            let claimTx: ContractTransaction;
            let claimTxBlock: number;

            beforeEach(async () => {
                await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);

                await mine(10);
                
                claimTx = await stakingModule.connect(bob).claim(emptyBytes);
                claimTxBlock = claimTx.blockNumber || -1;
                assert(claimTxBlock != -1);
            });

            it("should emit relevant events", async () => {
                expect(claimTx).to.emit(simplePlugin, "Claimed");
                expect(claimTx).to.emit(stakingModule, "Claimed");
            })

            it("should increase bob's tel balance", async () => {
                expect(await telContract.balanceOf(bob.address)).to.equal(bobAmtToCredit);
            });

            it("should decrease StakingModule::totalSupply()", async () => {
                expect(await stakingModule.totalSupply()).to.equal(0);
            });

            it("should decrease StakingModule::balanceOf(bob)", async () => {
                expect(await stakingModule.balanceOf(bob.address, emptyBytes)).to.equal(0);
            });

            it("should decrease StakingModule::claimable(bob)", async () => {
                expect(await stakingModule.claimable(bob.address, emptyBytes)).to.equal(0);
            });

            it("should create checkpoints for StakingModule::balanceOfAt(bob) and StakingModule::claimableAt(bob)", async () => {
                await mine(10);

                expect(await stakingModule.claimableAt(bob.address, claimTxBlock - 1, "0x")).to.equal(bobAmtToCredit);
                expect(await stakingModule.claimableAt(bob.address, claimTxBlock, "0x")).to.equal(0);
                expect(await stakingModule.claimableAt(bob.address, claimTxBlock + 1, "0x")).to.equal(0);

                expect(await stakingModule.balanceOfAt(bob.address, claimTxBlock - 1, "0x")).to.equal(bobAmtToCredit);
                expect(await stakingModule.balanceOfAt(bob.address, claimTxBlock, "0x")).to.equal(0);
                expect(await stakingModule.balanceOfAt(bob.address, claimTxBlock + 1, "0x")).to.equal(0);
            });
        });

        describe("when user stakes first", () => {
            const bobAmtStake = 100;
            const bobAmtToCredit = 50;

            let claimTx: ContractTransaction;
            let claimTxBlock: number;

            beforeEach(async () => {
                await telContract.connect(increaser).transfer(bob.address, bobAmtStake);

                await stakingModule.connect(bob).stake(bobAmtStake);

                await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);

                await mine(10);
                
                claimTx = await stakingModule.connect(bob).claim(emptyBytes);
                claimTxBlock = claimTx.blockNumber || -1;
                assert(claimTxBlock != -1);
            });

            it("should emit relevant events", async () => {
                expect(claimTx).to.emit(simplePlugin, "Claimed");
                expect(claimTx).to.emit(stakingModule, "Claimed");
            })

            it("should increase bob's tel balance", async () => {
                expect(await telContract.balanceOf(bob.address)).to.equal(bobAmtToCredit);
            });

            it("should not decrease StakingModule::stakedBy(bob)", async () => {
                expect(await stakingModule.stakedBy(bob.address)).to.equal(bobAmtStake);
            });

            it("should decrease StakingModule::totalSupply()", async () => {
                expect(await stakingModule.totalSupply()).to.equal(bobAmtStake);
            });

            it("should decrease StakingModule::balanceOf(bob)", async () => {
                expect(await stakingModule.balanceOf(bob.address, emptyBytes)).to.equal(bobAmtStake);
            });

            it("should decrease StakingModule::claimable(bob)", async () => {
                expect(await stakingModule.claimable(bob.address, emptyBytes)).to.equal(0);
            });

            it("should create checkpoints for StakingModule::balanceOfAt(bob) and StakingModule::claimableAt(bob)", async () => {
                await mine(10);

                expect(await stakingModule.claimableAt(bob.address, claimTxBlock - 1, "0x")).to.equal(bobAmtToCredit);
                expect(await stakingModule.claimableAt(bob.address, claimTxBlock, "0x")).to.equal(0);
                expect(await stakingModule.claimableAt(bob.address, claimTxBlock + 1, "0x")).to.equal(0);

                expect(await stakingModule.balanceOfAt(bob.address, claimTxBlock - 1, "0x")).to.equal(bobAmtToCredit + bobAmtStake);
                expect(await stakingModule.balanceOfAt(bob.address, claimTxBlock, "0x")).to.equal(bobAmtStake);
                expect(await stakingModule.balanceOfAt(bob.address, claimTxBlock + 1, "0x")).to.equal(bobAmtStake);
            });
        });
    });

    describe("StakingModule::claimFromIndividualPlugin", () => {
        describe("when index OOB", () => {
            it("should fail", async () => {
                await expect(stakingModule.connect(bob).claimFromIndividualPlugin(1, emptyBytes)).to.be.revertedWith("StakingModule::_claimFromIndividualPlugin: Provided pluginIndex is out of bounds");
            });
        });

        describe("when index is 0 (SimplePlugin)", () => {
            describe("when there is nothing to claim", () => {
                it("should not emit Claimed", async () => {
                    const tx = await stakingModule.connect(bob).claimFromIndividualPlugin(0, emptyBytes);
                    expect(tx).to.not.emit(stakingModule, "Claimed");
                    expect(tx).to.not.emit(simplePlugin, "Claimed");
                });
            });

            describe("when there is something to claim", () => {
                const bobAmtToCredit = 10;
                let tx: ContractTransaction;
                beforeEach(async () => {
                    await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);
                    tx = await stakingModule.connect(bob).claimFromIndividualPlugin(0, emptyBytes);
                });

                it("should emit Claimed", async () => {
                    expect(tx).to.emit(stakingModule, "Claimed");
                    expect(tx).to.emit(simplePlugin, "Claimed");
                });

                it("should transfer the tokens to bob", async () => {
                    expect(await telContract.balanceOf(bob.address)).to.equal(bobAmtToCredit);
                    expect(await telContract.balanceOf(simplePlugin.address)).to.equal(0);
                    expect(await telContract.balanceOf(stakingModule.address)).to.equal(0);
                });
            });
        });
    });

    describe("StakingModule::exit", () => {
        describe("when there is yield but no stake", () => {
            const bobAmtToCredit = 50;
            let exitTx: ContractTransaction;

            beforeEach(async () => {
                await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);
                exitTx = await stakingModule.connect(bob).exit();
            })
            
            it("should not emit any events", async () => {
                expect(exitTx).to.not.emit(stakingModule, "StakeChanged");
                expect(exitTx).to.not.emit(stakingModule, "Claimed");
            });

            it("should not transfer any TEL", async () => {
                expect(exitTx).to.not.emit(telContract, "Transfer");
            });
        });

        describe("when there is yield and stake", () => {
            const bobAmtStake = 100;
            const bobAmtToCredit = 50;
            let exitTx: ContractTransaction;

            beforeEach(async () => {
                await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);

                await telContract.connect(increaser).transfer(bob.address, bobAmtStake);
                
                await stakingModule.connect(bob).stake(bobAmtStake);

                await mine(10);

                exitTx = await stakingModule.connect(bob).exit();
            });

            it("should emit relevant events only", async () => {
                expect(exitTx).to.emit(stakingModule, "StakeChanged");
                // expect(exitTx).to.emit(simplePlugin, "NotifyExit");

                expect(exitTx).to.not.emit(stakingModule, "Claimed");
                expect(exitTx).to.not.emit(simplePlugin, "Claimed");
            });

            it("should increase bob's tel balance", async () => {
                expect(await telContract.balanceOf(bob.address)).to.equal(bobAmtStake);
            });

            it('should decrease balanceOf(bob)', async () => {
                expect(await stakingModule.balanceOf(bob.address, emptyBytes)).to.equal(bobAmtToCredit);
            });

            it('should decrease stakedBy(bob)', async () => {
                expect(await stakingModule.stakedBy(bob.address)).to.equal(0);
            });

            it('should decrease totalStaked()', async () => {
                expect(await stakingModule.totalStaked()).to.equal(0);
            });

            it('should decrease totalSupply()', async () => {
                expect(await stakingModule.totalSupply()).to.equal(bobAmtToCredit);
            });

            // i don't want to test checkpoints again, i'm sure it works if everything else does
        });
    });

    describe("StakingModule::slash", () => {
        describe("when user is staked and has yield", () => {
            const bobAmtStake = 100;
            const bobAmtToCredit = 50;

            beforeEach(async () => {
                await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);

                await telContract.connect(increaser).transfer(bob.address, bobAmtStake);
                
                await stakingModule.connect(bob).stake(bobAmtStake);
            });

            describe("when slashed amount is less than staked+yield, more than staked", () => {
                const bobAmtToSlash = 110;
                const amtLeft = bobAmtStake + bobAmtToCredit - bobAmtToSlash;
                let slashTx: ContractTransaction;
                let slashTxBlock: number;

                beforeEach(async () => {
                    await mine(10);
                    slashTx = await stakingModule.connect(slasher).slash(bob.address, bobAmtToSlash, charlie.address, emptyBytes);
                    slashTxBlock = slashTx.blockNumber || -1;
                    assert(slashTxBlock != -1);
                });

                it("should emit relevant events", async () => {
                    expect(slashTx).to.emit(stakingModule, "StakeChanged");
                    expect(slashTx).to.emit(stakingModule, "Slashed");
                    expect(slashTx).to.emit(stakingModule, "Claimed");

                    // expect(slashTx).to.emit(simplePlugin, "NotifyExit");
                    // expect(slashTx).to.emit(simplePlugin, "NotifyStake");
                    expect(slashTx).to.emit(simplePlugin, "Claimed");
                });

                it("should increase charlie's tel balance", async () => {
                    expect(await telContract.balanceOf(charlie.address)).to.equal(bobAmtToSlash);
                });

                it("should decrease StakingModule tel balance", async () => {
                    expect(await telContract.balanceOf(stakingModule.address)).to.equal(amtLeft);
                });

                it("should decrease SimplePlugin tel balance", async () => {
                    expect(await telContract.balanceOf(simplePlugin.address)).to.equal(0);
                });

                it("should not change bob's tel balance", async () => {
                    expect(await telContract.balanceOf(bob.address)).to.equal(0);
                });
    
                it('should decrease StakingModule::balanceOf(bob)', async () => {
                    expect(await stakingModule.balanceOf(bob.address, emptyBytes)).to.equal(amtLeft);
                });
    
                it('should decrease StakingModule::stakedBy(bob)', async () => {
                    expect(await stakingModule.stakedBy(bob.address)).to.equal(amtLeft);
                });
    
                it('should decrease StakingModule::totalStaked()', async () => {
                    expect(await stakingModule.totalStaked()).to.equal(amtLeft);
                });
    
                it('should decrease StakingModule::totalSupply()', async () => {
                    expect(await stakingModule.totalSupply()).to.equal(amtLeft);
                });

                it("should decrease StakingModule::claimable(bob)", async () => {
                    expect(await stakingModule.claimable(bob.address, emptyBytes)).to.equal(0);
                });

                it("should update checkpoints", async () => {
                    await mine(10);

                    expect(await stakingModule.claimableAt(bob.address, slashTxBlock - 1, "0x")).to.equal(bobAmtToCredit);
                    expect(await stakingModule.claimableAt(bob.address, slashTxBlock, "0x")).to.equal(0);
                    expect(await stakingModule.claimableAt(bob.address, slashTxBlock + 1, "0x")).to.equal(0);

                    expect(await stakingModule.balanceOfAt(bob.address, slashTxBlock - 1, "0x")).to.equal(bobAmtToCredit + bobAmtStake);
                    expect(await stakingModule.balanceOfAt(bob.address, slashTxBlock, "0x")).to.equal(amtLeft);
                    expect(await stakingModule.balanceOfAt(bob.address, slashTxBlock + 1, "0x")).to.equal(amtLeft);
                });
            });
        });
    });

    describe("StakingModule::removePlugin", () => {
        describe("when user is staked and has yield", () => {
            const bobAmtStake = 100;
            const bobAmtToCredit = 50;
            let yieldedBlock: number;
            let rmBlock: number;

            beforeEach(async () => {
                await telContract.connect(increaser).transfer(bob.address, bobAmtStake);
                
                await stakingModule.connect(bob).stake(bobAmtStake);

                const yieldTx = await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);

                yieldedBlock = yieldTx.blockNumber || -1;
                assert(yieldedBlock != -1);

                await mine(10);

                const rmTx = await stakingModule.connect(editor).removePlugin(0);
                rmBlock = rmTx.blockNumber || -1;
                assert(rmBlock != -1);
            });

            it("should zero out user's claimable", async () => {
                expect(await stakingModule.claimable(bob.address, emptyBytes)).to.equal(0);
            });

            it("should update checkpoints", async () => {
                // NOTE: THIS IS MAYBE ODD BEHAVIOR, BUT IT FEELS LIKE IT SHOULD WORK THIS WAY
                await mine(10);

                expect(await stakingModule.claimableAt(bob.address, rmBlock - 1, "0x")).to.equal(0);
                expect(await stakingModule.claimableAt(bob.address, rmBlock, "0x")).to.equal(0);
                expect(await stakingModule.claimableAt(bob.address, rmBlock + 1, "0x")).to.equal(0);

                expect(await stakingModule.balanceOfAt(bob.address, rmBlock - 1, "0x")).to.equal(bobAmtStake);
                expect(await stakingModule.balanceOfAt(bob.address, rmBlock, "0x")).to.equal(bobAmtStake);
                expect(await stakingModule.balanceOfAt(bob.address, rmBlock + 1, "0x")).to.equal(bobAmtStake);
            });

        })
    })
});