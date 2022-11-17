import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect, assert } from "chai";
import { BigNumber, Bytes, ContractTransaction } from "ethers";
import { ethers } from "hardhat";
import { SimplePlugin, TEL } from "../../typechain";
import { MockStakingModule } from "../../typechain/MockStakingModule";
import { mine } from "../helpers";

const emptyBytes: Bytes = [];

describe("SimplePlugin", () => {
    let deployer: SignerWithAddress;
    let bob: SignerWithAddress;
    let charlie: SignerWithAddress;
    let increaser: SignerWithAddress;
    
    let telContract: TEL;
    let mockStakingModule: MockStakingModule;
    let simplePlugin: SimplePlugin;

    let telTotalSupply: BigNumber;


    beforeEach('setup', async () => {
        [deployer, bob, charlie, increaser] = await ethers.getSigners();

        const TELFactory = await ethers.getContractFactory("TEL", deployer);
        const SimplePluginFactory = await ethers.getContractFactory("SimplePlugin", deployer);
        const MockStakingModuleFactory = await ethers.getContractFactory("MockStakingModule", deployer);

        telContract = await TELFactory.deploy("Telcoin", "TEL");
        mockStakingModule = await MockStakingModuleFactory.deploy(telContract.address);
        simplePlugin = await SimplePluginFactory.deploy(mockStakingModule.address);

        telTotalSupply = await telContract.totalSupply();

        await mockStakingModule.setFb(simplePlugin.address);
        await telContract.connect(deployer).transfer(increaser.address, telTotalSupply);

        expect(await telContract.balanceOf(increaser.address)).to.equal(telTotalSupply);
    });


    describe("onlyStaking", () => {
        describe("claim", () => {
            describe("when called by non-staking", () => {
                it("should fail", async () => {
                    await expect(simplePlugin.connect(bob).claim(bob.address, charlie.address, emptyBytes)).to.be.revertedWith("SimplePlugin::onlyStaking: Caller is not StakingModule");
                });
            });

            describe("when called by staking", () => {
                it("should not revert", async () => {
                    await expect(mockStakingModule.claimWithArbitraryParams(bob.address, charlie.address, emptyBytes)).to.not.be.reverted;
                })
            })
        });
    });

    describe("setIncreaser", () => {
        describe("when called by non-owner", () => {
            it("should fail", async () => {
                await expect(simplePlugin.connect(bob).setIncreaser(increaser.address)).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });

        describe("when called by owner", () => {
            let txPromise: Promise<ContractTransaction>;
            beforeEach(async () => {
                txPromise = simplePlugin.connect(deployer).setIncreaser(increaser.address);
            });

            it("should not revert", async () => {
                await expect(txPromise).to.not.be.reverted;
            });

            it("should properly set increaser", async () => {
                await txPromise;
                expect(await simplePlugin.increaser()).to.equal(increaser.address);
            });

            it("should emit an event", async () => {
                expect(txPromise).to.emit(simplePlugin, "IncreaserChanged");
            });
        });
    });

    describe("increaseClaimableBy", () => {
        describe("when caller is not increaser", () => {
            it("should fail", async () => {
                await expect(simplePlugin.connect(bob).increaseClaimableBy(bob.address, 100)).to.be.revertedWith("SimplePlugin::onlyIncreaser: Caller is not Increaser");
            });
        });

        describe("when caller is increaser", () => {
            beforeEach(async () => {
                await simplePlugin.connect(deployer).setIncreaser(increaser.address);
            });

            describe("when not approved", () => {
                it("should fail", async () => {
                    await expect(simplePlugin.connect(increaser).increaseClaimableBy(bob.address, 100)).to.be.revertedWith('ERC20: insufficient allowance');
                });
            });

            describe("when amount is larger than increaser's balance", () => {
                it("should fail", async () => {
                    await telContract.connect(increaser).approve(simplePlugin.address, ethers.constants.MaxUint256);
                    await expect(simplePlugin.connect(increaser).increaseClaimableBy(bob.address, telTotalSupply.add(1))).to.be.revertedWith("ERC20: transfer amount exceeds balance");
                });
            });

            describe("when amount and allowance are ok", () => {
                const bobAmtToCredit = 100;
                let increaseTx: ContractTransaction;
                let increaseTxBlock: number;

                beforeEach(async () => {
                    await telContract.connect(increaser).approve(simplePlugin.address, ethers.constants.MaxUint256);
                    increaseTx = await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);
                    increaseTxBlock = increaseTx.blockNumber || -1;
                    assert(increaseTxBlock != -1);
                });

                it("should emit ClaimableIncreased", async () => {
                    expect(increaseTx).to.emit(simplePlugin, "ClaimableIncreased");
                })

                it("should increase contract's tel balance", async () => {
                    expect(await telContract.balanceOf(simplePlugin.address)).to.equal(bobAmtToCredit);
                });

                it("should increase totalClaimable()", async () => {
                    expect(await simplePlugin.totalClaimable()).to.equal(bobAmtToCredit);
                });

                it("should increase claimable(bob)", async () => {
                    expect(await simplePlugin.claimable(bob.address, emptyBytes)).to.equal(bobAmtToCredit);
                });

                it("should create checkpoints before, at, and after", async () => {
                    await mine(10);

                    expect(await simplePlugin.claimableAt(bob.address, increaseTxBlock - 1, "0x")).to.equal(0);
                    expect(await simplePlugin.claimableAt(bob.address, increaseTxBlock, "0x")).to.equal(bobAmtToCredit);
                    expect(await simplePlugin.claimableAt(bob.address, increaseTxBlock + 1, "0x")).to.equal(bobAmtToCredit);
                });
            });
        });
    });

    describe("claim", () => {
        describe("when there is nothing to claim", () => {
            it("should do nothing and not revert", async () => {
                const txPromise = mockStakingModule.claimWithArbitraryParams(bob.address, charlie.address, emptyBytes);

                await expect(txPromise).to.not.be.reverted;
            });
        });

        describe("when there is something to claim", () => {
            const bobAmtToCredit = 100;
            let increaseTx: ContractTransaction;
            let increaseTxBlock: number;

            let claimTx: ContractTransaction;
            let claimTxBlock: number;

            beforeEach(async () => {
                await simplePlugin.connect(deployer).setIncreaser(increaser.address);

                await telContract.connect(increaser).approve(simplePlugin.address, ethers.constants.MaxUint256);
                increaseTx = await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);
                increaseTxBlock = increaseTx.blockNumber || -1;

                assert(increaseTxBlock != -1);

                await mine(10);

                claimTx = await mockStakingModule.claimWithArbitraryParams(bob.address, charlie.address, emptyBytes);
                claimTxBlock = claimTx.blockNumber || -1;

                assert(claimTxBlock != -1);
            });

            it("should emit Claimed", async () => {
                expect(claimTx).to.emit(simplePlugin, "Claimed");
            })

            it("should reduce contract's tel balance", async () => {
                expect(await telContract.balanceOf(simplePlugin.address)).to.equal(0);
            });

            it("should increase charlie's tel balance", async () => {
                expect(await telContract.balanceOf(charlie.address)).to.equal(bobAmtToCredit);
            })

            it("should reduce totalClaimable()", async () => {
                expect(await simplePlugin.totalClaimable()).to.equal(0);
            });

            it("should reduce claimable(bob)", async () => {
                expect(await simplePlugin.claimable(bob.address, emptyBytes)).to.equal(0);
            });

            it("should create checkpoints", async () => {
                await mine(10);

                expect(await simplePlugin.claimableAt(bob.address, increaseTxBlock - 1, "0x")).to.equal(0);
                expect(await simplePlugin.claimableAt(bob.address, increaseTxBlock, "0x")).to.equal(bobAmtToCredit);
                expect(await simplePlugin.claimableAt(bob.address, increaseTxBlock + 1, "0x")).to.equal(bobAmtToCredit);

                expect(await simplePlugin.claimableAt(bob.address, claimTxBlock - 1, "0x")).to.equal(bobAmtToCredit);
                expect(await simplePlugin.claimableAt(bob.address, claimTxBlock, "0x")).to.equal(0);
                expect(await simplePlugin.claimableAt(bob.address, claimTxBlock + 1, "0x")).to.equal(0);
            });
        });
    });

    describe("rescueTokens", () => {
        const bobAmtToCredit = 100;
        const extraTelAmt = 10;
        const extraOtherTokenAmt = 20;
        let otherTokenContract: TEL;

        beforeEach(async () => {
            // some user has yield
            await simplePlugin.connect(deployer).setIncreaser(increaser.address);
            await telContract.connect(increaser).approve(simplePlugin.address, ethers.constants.MaxUint256);
            await simplePlugin.connect(increaser).increaseClaimableBy(bob.address, bobAmtToCredit);

            // send some extra TEL
            await telContract.connect(increaser).transfer(simplePlugin.address, extraTelAmt);

            // send some non-TEL tokens
            const TELFactory = await ethers.getContractFactory("TEL", deployer);
            otherTokenContract = await TELFactory.deploy("Telcoin", "TEL");

            otherTokenContract.connect(deployer).transfer(simplePlugin.address, extraOtherTokenAmt);
        });

        describe("when called by non-owner", () => {
            it("should fail", async () => {
                await expect(simplePlugin.connect(bob).rescueTokens(telContract.address, bob.address)).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });

        describe("when called by owner", () => {
            describe("when rescuing TEL", () => {
                it("should return ONLY the extra amount, not everything in the contract", async () => {
                    const balBefore = await telContract.balanceOf(charlie.address);
                    await simplePlugin.connect(deployer).rescueTokens(telContract.address, charlie.address);
                    const balAfter = await telContract.balanceOf(charlie.address);

                    expect(balAfter.sub(balBefore)).to.equal(extraTelAmt);
                    expect(await telContract.balanceOf(simplePlugin.address)).to.equal(bobAmtToCredit);
                });
            });

            describe("when rescuing non-TEL", () => {
                it("should return entire balance of contract", async () => {
                    const balBefore = await otherTokenContract.balanceOf(charlie.address);
                    await simplePlugin.connect(deployer).rescueTokens(otherTokenContract.address, charlie.address);
                    const balAfter = await otherTokenContract.balanceOf(charlie.address);

                    expect(balAfter.sub(balBefore)).to.equal(extraOtherTokenAmt);
                    expect(await otherTokenContract.balanceOf(simplePlugin.address)).to.equal(0);
                });
            });
        });
    });
});