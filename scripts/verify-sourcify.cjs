/*
 * Submits the AirdropSender source to Sourcify's v2 API, because hardhat-verify still uses the removed v1 API.
 * Usage: CONTRACT_ADDRESS=0x... npx hardhat run scripts/verify-sourcify.cjs --network <network>
 */
const hre = require('hardhat');

const FULLY_QUALIFIED_NAME = 'contracts/AirdropSender.sol:AirdropSender';
const SOURCE_NAME = 'contracts/AirdropSender.sol';
const API = 'https://sourcify.dev/server/v2/verify';

async function main() {
    const address = process.env.CONTRACT_ADDRESS;
    if (!hre.ethers.isAddress(address)) throw new Error('CONTRACT_ADDRESS env var is missing or invalid.');

    await hre.run('compile');

    const {chainId} = await hre.ethers.provider.getNetwork();
    const buildInfo = await hre.artifacts.getBuildInfo(FULLY_QUALIFIED_NAME);
    const metadata = JSON.parse(buildInfo.output.contracts[SOURCE_NAME].AirdropSender.metadata);

    /* Only the contract's own sources, so test mocks are not published. */
    const sources = {};
    for (const name of Object.keys(metadata.sources)) {
        sources[name] = {content: buildInfo.input.sources[name].content};
    }

    const submit = await fetch(`${API}/${chainId}/${address}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
            stdJsonInput: {...buildInfo.input, sources},
            compilerVersion: buildInfo.solcLongVersion,
            contractIdentifier: FULLY_QUALIFIED_NAME
        })
    });
    const {verificationId} = await submit.json();
    /* 409: Sourcify already has this contract, for example through its Etherscan import. */
    if (submit.status === 409) {
        const existing = await (await fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${address}`)).json();
        console.log('Sourcify match (already verified):', existing.match);
        return;
    }
    if (!verificationId) throw new Error(`Sourcify rejected the request with status ${submit.status}.`);

    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 6000));
        const job = await (await fetch(`${API}/${verificationId}`)).json();
        if (job.isJobCompleted) {
            if (job.error) throw new Error(`Sourcify verification failed: ${job.error.customCode ?? job.error.message}`);
            console.log('Sourcify match:', job.contract?.match);
            return;
        }
    }
    throw new Error(`Sourcify job ${verificationId} did not finish in time.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
