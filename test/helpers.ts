import { ethers } from "hardhat";

export async function mine(blocks: number): Promise<void> {
    for (let i = 0; i < blocks; i++) {
        await ethers.provider.send("evm_mine", []);
    }
}

export async function getLatestBlockNumber(): Promise<number> {
    return (await ethers.provider.getBlock('latest')).number;
}

export function generateRandomAddress(): string {
    const randIntStr = Math.floor(Math.random()*100000) + '';
    const randHex = '0x' + '0'.repeat(64 - randIntStr.length) + randIntStr;
    return ethers.utils.getAddress(ethers.utils.keccak256(randHex).substring(0, 42));
}

export function generateNRandomAddresses(n: number): string[] {
    const ans = [];
    
    for (let i = 0; i < n; i++) {
        ans.push(generateRandomAddress());
    }

    return ans;
}