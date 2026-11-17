require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/* Only needed to deploy or verify; see .env.example. The tests run without any of these. */
const alchemyKey = process.env.ALCHEMY_DEPLOY_API_KEY || '';
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || '';
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || '';

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
    solidity: {
        version: '0.8.20',
        settings: {
            optimizer: { enabled: true, runs: 200 }
        }
    },
    networks: {
        hardhat: {
            /* The protocol limit per transaction, so estimates cannot search above it */
            blockGasLimit: 16_777_216
        },
        sepolia: {
            url: `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`,
            accounts: deployerKey ? [deployerKey] : []
        },
        mainnet: {
            url: `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
            accounts: deployerKey ? [deployerKey] : []
        },
        base: {
            url: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
            accounts: deployerKey ? [deployerKey] : []
        },
        bnb: {
            url: `https://bnb-mainnet.g.alchemy.com/v2/${alchemyKey}`,
            accounts: deployerKey ? [deployerKey] : []
        }
    },
    etherscan: {
        apiKey: etherscanApiKey
    },
    /* The plugin still calls Sourcify's removed v1 API. Submit to https://sourcify.dev/server/v2/verify directly. */
    sourcify: {
        enabled: false
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS === 'true'
    }
};
