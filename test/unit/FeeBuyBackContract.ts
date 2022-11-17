import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect, assert } from "chai";
import { BigNumber, Bytes, ContractTransaction } from "ethers";
import { ethers, upgrades } from "hardhat";
import { FeeBuyback, Token, InsecureWallet, YieldSource } from "../../typechain";
import { mine, getLatestBlockNumber, generateNRandomAddresses } from "../helpers";

describe("Fee Buy Back", () => {
  let coinbase: SignerWithAddress;
  let recipient: SignerWithAddress;

  let feeBuyback: FeeBuyback;
  let tokenA: Token;
  let tokenB: Token;
  let wallet: InsecureWallet;
  let safe: InsecureWallet;
  let swapper: InsecureWallet;
  let yieldSource: YieldSource;

  beforeEach('setup', async () => {
    [coinbase, recipient] = await ethers.getSigners();

    const FeeBuybackFactory = await ethers.getContractFactory("FeeBuyback", coinbase);
    const TokenFactory = await ethers.getContractFactory("Token", coinbase);
    const InsecureWalletFactory = await ethers.getContractFactory("InsecureWallet", coinbase);
    const YieldSourceFactory = await ethers.getContractFactory("YieldSource", coinbase);
    
    tokenA = await TokenFactory.deploy();
    tokenB = await TokenFactory.deploy();
    wallet = await InsecureWalletFactory.deploy();
    safe = await InsecureWalletFactory.deploy();
    swapper = await InsecureWalletFactory.deploy();
    
    await tokenA.deployed();
    await tokenB.deployed();
    await wallet.deployed();
    await safe.deployed();
    await swapper.deployed();

    yieldSource = await YieldSourceFactory.deploy(tokenB.address, wallet.address, recipient.address);
    await yieldSource.deployed();
    feeBuyback = await FeeBuybackFactory.deploy(swapper.address, safe.address, tokenB.address, yieldSource.address);
    await feeBuyback.deployed();

    await feeBuyback.connect(coinbase).addOwner(coinbase.address);

    await tokenA.connect(coinbase).transfer(wallet.address, '10000');
    await tokenA.connect(coinbase).transfer(safe.address, '10000');

    await tokenB.connect(coinbase).transfer(safe.address, '10000');
    await tokenB.connect(coinbase).transfer(swapper.address, '10000');

    await wallet.connect(coinbase).approveTokens(tokenA.address, swapper.address, '10000');
    await safe.connect(coinbase).approveTokens(tokenA.address, feeBuyback.address, '10000');
    await safe.connect(coinbase).approveTokens(tokenB.address, feeBuyback.address, '10000');
  });
    
  describe("match up", () => {
    it("default values", async () => {
      expect((await feeBuyback.MATIC())).to.equal("0x0000000000000000000000000000000000001010");
      expect((await feeBuyback._aggregator())).to.equal(swapper.address);
      expect((await feeBuyback._safe())).to.equal(safe.address);
      expect((await feeBuyback._telcoin())).to.equal(tokenB.address);
      expect((await feeBuyback._referral())).to.equal(yieldSource.address);
    });

    it("submit without secondary swap, all zeros", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '0', '0x');

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit without secondary swap, zero amount", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, coinbase.address, coinbase.address, '0', walletData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit without secondary swap, zero address token", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, '0x0000000000000000000000000000000000000000', coinbase.address, '10', walletData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit without secondary swap, zero address recipient", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, coinbase.address, '0x0000000000000000000000000000000000000000', '10', walletData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit with telcoin", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '3', '4' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, tokenB.address, recipient.address, '10', '0x')

      expect(await tokenA.balanceOf(swapper.address)).to.equal('3');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('4');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('10');
    });
  
    it("submit with secondary swap", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '5', '6' ]).slice(2)
      //swapTokens
      let swapData = '0x8e18cdfc' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "uint256", "uint256" ], [ tokenA.address, tokenB.address, '7', '8' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, tokenA.address, recipient.address, '7', swapData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('12');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('6');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('8');
    });

    it("ERC rescue", async () => {
      await tokenB.connect(coinbase).transfer(feeBuyback.address, '10000');
      await feeBuyback.connect(coinbase).rescueERC20(safe.address, tokenB.address, '10000')

      expect(await tokenB.balanceOf(safe.address)).to.equal('20000');
    });
  });

  describe("match up", () => {
    it("default values", async () => {
      expect((await feeBuyback.MATIC())).to.equal("0x0000000000000000000000000000000000001010");
      expect((await feeBuyback._aggregator())).to.equal(swapper.address);
      expect((await feeBuyback._safe())).to.equal(safe.address);
      expect((await feeBuyback._telcoin())).to.equal(tokenB.address);
      expect((await feeBuyback._referral())).to.equal(yieldSource.address);
    });

    it("submit without secondary swap, all zeros", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '0', '0x');

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit without secondary swap, zero amount", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, coinbase.address, coinbase.address, '0', walletData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit without secondary swap, zero address token", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, '0x0000000000000000000000000000000000000000', coinbase.address, '10', walletData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit without secondary swap, zero address recipient", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '1', '2' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, coinbase.address, '0x0000000000000000000000000000000000000000', '10', walletData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('1');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('2');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('0');
    });
  
    it("submit with telcoin", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '3', '4' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, tokenB.address, recipient.address, '10', '0x')

      expect(await tokenA.balanceOf(swapper.address)).to.equal('3');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('4');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('10');
    });
  
    it("submit with secondary swap", async () => {
      //passSwap
      let walletData = '0x0bb11400' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "address", "uint256", "uint256" ], [ swapper.address, tokenA.address, tokenB.address, '5', '6' ]).slice(2)
      //swapTokens
      let swapData = '0x8e18cdfc' + ethers.utils.defaultAbiCoder.encode([ "address", "address", "uint256", "uint256" ], [ tokenA.address, tokenB.address, '7', '8' ]).slice(2)
      await feeBuyback.connect(coinbase).submit(wallet.address, walletData, tokenA.address, recipient.address, '7', swapData)

      expect(await tokenA.balanceOf(swapper.address)).to.equal('12');
      expect(await tokenB.balanceOf(wallet.address)).to.equal('6');
      expect(await tokenB.balanceOf(yieldSource.address)).to.equal('8');
    });

    it("ERC rescue", async () => {
      await tokenB.connect(coinbase).transfer(feeBuyback.address, '10000');
      await feeBuyback.connect(coinbase).rescueERC20(safe.address, tokenB.address, '10000')

      expect(await tokenB.balanceOf(safe.address)).to.equal('20000');
    });
  });

  describe("TieredOwnership", () => {
    it("only executor", async () => {
        await expect(feeBuyback.connect(recipient).addOwner(recipient.address)).to.be.revertedWith("TieredOwnership: caller is not an executor");
    });
    
    it("only owner", async () => {
        await expect(feeBuyback.connect(recipient).submit(wallet.address, '0x', coinbase.address, coinbase.address, '0', '0x')).to.be.revertedWith("TieredOwnership: caller is not an owner");
    });

    it("default values", async () => {
        expect((await feeBuyback.executor())).to.equal(coinbase.address);
    });

    it("set executor", async () => {
        expect((await feeBuyback.nominatedExecutor())).to.equal('0x0000000000000000000000000000000000000000');
        await feeBuyback.connect(coinbase).nominateExecutor(recipient.address);
        expect((await feeBuyback.nominatedExecutor())).to.equal(recipient.address);
        await feeBuyback.connect(recipient).acceptExecutorship();
        expect((await feeBuyback.nominatedExecutor())).to.equal('0x0000000000000000000000000000000000000000');
        expect((await feeBuyback.executor())).to.equal(recipient.address);
    });

    it("set owners", async () => {
        expect((await feeBuyback.isOwner(coinbase.address))).to.equal(true);
        expect((await feeBuyback.isOwner(recipient.address))).to.equal(false);

        await feeBuyback.connect(coinbase).addOwner(recipient.address);
        expect((await feeBuyback.isOwner(recipient.address))).to.equal(true);
        await feeBuyback.connect(coinbase).removeOwner(recipient.address);
        expect((await feeBuyback.isOwner(recipient.address))).to.equal(false);
    });
  });
});