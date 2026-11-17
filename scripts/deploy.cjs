const hre = require('hardhat');

/* A single key must not control the fees on production networks. */
const NETWORKS_WITHOUT_MULTISIG_REQUIREMENT = ['sepolia'];

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log('Deploying AirdropSender with account:', deployer.address);
    console.log('Network:', hre.network.name);

    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log('Account balance:', hre.ethers.formatEther(balance));

    const FEE_WALLET = process.env.FEE_WALLET || '';

    if (!hre.ethers.isAddress(FEE_WALLET) || FEE_WALLET === hre.ethers.ZeroAddress) {
        throw new Error('FEE_WALLET env var is missing or invalid. Add it to .env');
    }

    const feeWalletCode = await hre.ethers.provider.getCode(FEE_WALLET);
    if (
        feeWalletCode === '0x'
        && !NETWORKS_WITHOUT_MULTISIG_REQUIREMENT.includes(hre.network.name)
        && process.env.ALLOW_EOA_FEE_WALLET !== 'true'
    ) {
        throw new Error(`FEE_WALLET ${FEE_WALLET} has no contract code on ${hre.network.name}. Use a multisig, because the fee wallet can never be changed after deployment. Set ALLOW_EOA_FEE_WALLET=true to override.`);
    }

    console.log('Fee wallet:', FEE_WALLET);

    const AirdropSender = await hre.ethers.getContractFactory('AirdropSender');
    const contract = await AirdropSender.deploy(FEE_WALLET);
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log('\nAirdropSender deployed to:', address);
    console.log('\nTo verify the source:');
    console.log(`  npx hardhat verify --network ${hre.network.name} ${address} ${FEE_WALLET}`);
    console.log(`  CONTRACT_ADDRESS=${address} npx hardhat run scripts/verify-sourcify.cjs --network ${hre.network.name}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
