import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect, assert } from "chai";
import { BigNumber, BigNumberish } from "ethers";
import { ethers } from "hardhat";
import { AuxDataLibWrapper } from "../../typechain/AuxDataLibWrapper";

type HeaderItem = {
    addr: string;
    start: BigNumberish,
    len: BigNumberish
}

describe("AuxDataParse", () => {
    let deployer: SignerWithAddress;
    let auxDataParseContract: AuxDataLibWrapper;
    const abiEncoder = new ethers.utils.AbiCoder();
    
    const payload = '0x01020304';
    const headerItems = [
        {addr: "0xea674fdde714fd979de3edf0f56aa9716b898ec1", start: 1, len: 2}, // valid subsection
        {addr: "0xea674fdde714fd979de3edf0f56aa9716b898ec2", start: 25, len: 1}, // start is too high
        {addr: "0xea674fdde714fd979de3edf0f56aa9716b898ec3", start: 1, len: 20} // len is too high
    ];

    const encoded = abiEncoder.encode(
        ["struct(address addr, uint256 start, uint256 len)[]", "bytes"],
        [headerItems, payload]
    );

    beforeEach(async () => {
        [deployer] = await ethers.getSigners();

        const AuxDataParseFactory = await ethers.getContractFactory("AuxDataLibWrapper", deployer);

        auxDataParseContract = await AuxDataParseFactory.deploy() as AuxDataLibWrapper;
    });

    describe("parse", () => {
        let decoded: [([string, BigNumber, BigNumber] & {
            addr: string;
            start: BigNumber;
            len: BigNumber;
        })[], string];

        function compareHeaders(a: HeaderItem, b: HeaderItem): boolean {
            return a.addr.toLowerCase() === b.addr.toLowerCase()
                && BigNumber.from(a.start).eq(b.start) 
                && BigNumber.from(a.len).eq(b.len);
        }

        beforeEach(async () => {
            decoded = await auxDataParseContract.parse(encoded);
        });


        it("should properly parse out header items", async () => {
            assert(compareHeaders(headerItems[0], decoded[0][0]));
            assert(compareHeaders(headerItems[1], decoded[0][1]));
        });

        it("should properly parse out payload", async () => {
            expect(decoded[1]).to.equal(payload);
        });
    });

    describe("selectRelevantBytes", () => {
        it("should properly select relevant bytes from data according to address in header item", async () => {
            const relevantBytes = await auxDataParseContract.selectRelevantBytes(encoded, headerItems[0].addr);
            const expected = '0x' + payload.substring(2).substring(headerItems[0].start*2, headerItems[0].start*2 + headerItems[0].len*2);
            expect(relevantBytes).to.equal(expected);
        });

        it("should revert when start is too high", async () => {
            await expect(auxDataParseContract.selectRelevantBytes(encoded, headerItems[1].addr)).to.be.revertedWith("slice_outOfBounds");
        });

        it("should revert when len is too high", async () => {
            await expect(auxDataParseContract.selectRelevantBytes(encoded, headerItems[2].addr)).to.be.revertedWith("slice_outOfBounds");
        });
    });
});