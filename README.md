# AirdropSender.com EVM contract

The smart contract behind the [AirdropSender.com](https://airdropsender.com) multisender for Ethereum, Base and BNB Smart Chain. It sends ETH (or BNB) or an ERC-20 / BEP-20 token to many recipients in one transaction.

The tools that use it:

- Ethereum: https://ethereum.airdropsender.com
- Base: https://base.airdropsender.com
- BNB Smart Chain: https://bsc.airdropsender.com

## Deployed contracts

| Chain | Address | Verified source |
|---|---|---|
| Ethereum | `0x49DE9a3CaD11f3Af60CFBa50B047b8B82ec90F42` | [Etherscan](https://etherscan.io/address/0x49DE9a3CaD11f3Af60CFBa50B047b8B82ec90F42#code) |
| Base | `0x3B9E2482A1Ca06898447C31Be8B88B9F91D87616` | [BaseScan](https://basescan.org/address/0x3B9E2482A1Ca06898447C31Be8B88B9F91D87616#code) |
| BNB Smart Chain | `0x3B9E2482A1Ca06898447C31Be8B88B9F91D87616` | [BscScan](https://bscscan.com/address/0x3B9E2482A1Ca06898447C31Be8B88B9F91D87616#code) |

All three are also verified on [Sourcify](https://sourcify.dev) as an exact match. `contracts/AirdropSender.sol` in this repository is the source that was deployed: Solidity 0.8.20, optimizer enabled with 200 runs.

## What the contract does

`AirdropSender` has two functions:

- `disperseEther(recipients, values, feeAmount)` sends the native coin to each recipient.
- `disperseToken(token, recipients, values, feeAmount)` moves tokens from the sender to each recipient with `transferFrom`. The sender approves the contract for the total first.

Both take up to 400 recipients per call and pay `feeAmount` to the fee wallet. The AirdropSender.com tools send at most 200 native-coin transfers or 100 token transfers per transaction, which leaves room under the gas limit of a block.

## Design

- **No owner and no upgrade path.** There is no admin function, no pause and no proxy. The fee wallet is set in the constructor and is immutable.
- **Non-custodial.** Tokens go directly from the sender to each recipient. The contract does not hold them, and the native coin it receives leaves again in the same transaction.
- **One recipient cannot block the others.** A transfer that fails is skipped and reported with a `TransferFailed` event. For the native coin, the amount of a failed transfer is refunded to the sender.
- **Overpayment is refunded** to the sender in the same transaction.
- **Gas is capped per transfer** (50,000 for the native coin, 300,000 for a token), so a recipient or token cannot use up the gas of the whole batch. If the transaction's gas limit is too low to finish, the whole transaction reverts instead of reporting failures that are not the recipient's.
- **Tokens that return nothing**, such as USDT, are supported. At most 32 bytes of return data are read.
- **Reentrancy** is blocked with OpenZeppelin's `ReentrancyGuard`.
- With a **fee-on-transfer token**, each recipient receives the amount minus the token's own fee.

## Events

```solidity
event Dispersed(address indexed token, address indexed sender, uint256 totalRecipients, uint256 totalAmount);
event TransferFailed(address indexed token, address indexed recipient, uint256 amount);
```

`token` is the zero address for the native coin. `totalAmount` is the amount that was actually sent.

## Run the tests

Requires Node.js 20 or later.

```bash
npm install
npm test
```

The tests run on a local Hardhat network and need no keys or configuration. They cover both functions, the refunds, the gas limits, reentrancy, fee-on-transfer tokens and tokens with non-standard return values. The helper contracts in `contracts/mocks` exist only for the tests.

## Deploy

Copy `.env.example` to `.env` and fill it in, then:

```bash
npm run deploy:sepolia
```

The fee wallet can never be changed after deployment. On production networks the deploy script therefore stops when the fee wallet is a regular wallet instead of a contract such as a multisig; set `ALLOW_EOA_FEE_WALLET=true` to deploy with a regular wallet anyway.

## License

[MIT](LICENSE)
