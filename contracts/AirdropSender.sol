// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @notice Sends ETH or ERC-20 tokens to many recipients in one transaction.
 *         Has no owner and cannot be upgraded. Tokens go directly from the sender to each
 *         recipient, so this contract never holds them. A recipient whose transfer fails is
 *         skipped and reported with TransferFailed, so one recipient cannot block the others.
 */
contract AirdropSender is ReentrancyGuard {
    address payable public immutable feeWallet;

    /// @dev About 36,000 gas per new ETH recipient must fit in the 16,777,216 gas limit per transaction.
    uint256 public constant MAX_RECIPIENTS = 400;
    uint256 public constant ETH_TRANSFER_GAS = 50_000;
    uint256 public constant TOKEN_TRANSFER_GAS = 300_000;
    /// @notice Every airdrop pays at least the smallest unit of the native coin (1 wei) to the fee wallet.
    uint256 public constant MIN_FEE = 1;
    /// @dev Pays for sending value to a new account, emitting events and continuing the loop.
    uint256 private constant GAS_RESERVE = 50_000;

    /// @param token Zero address for ETH.
    event Dispersed(address indexed token, address indexed sender, uint256 totalRecipients, uint256 totalAmount);
    /// @param token Zero address for ETH.
    event TransferFailed(address indexed token, address indexed recipient, uint256 amount);

    constructor(address payable _feeWallet) {
        require(_feeWallet != address(0), "Invalid fee wallet");
        feeWallet = _feeWallet;
    }

    /**
     * @notice Distributes ETH. Amounts of failed transfers and any overpayment go back to the sender.
     * @param recipients  Destination addresses.
     * @param values      ETH amounts (wei) for each recipient.
     * @param feeAmount   Total service fee in wei, at least MIN_FEE.
     */
    function disperseEther(
        address[] calldata recipients,
        uint256[] calldata values,
        uint256 feeAmount
    ) external payable nonReentrant {
        _checkLengths(recipients.length, values.length);
        require(feeAmount >= MIN_FEE, "Fee too low");
        require(msg.value >= _sum(values) + feeAmount, "Insufficient ETH");

        uint256 sent = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            _requireGasFor(ETH_TRANSFER_GAS);
            (bool success, ) = payable(recipients[i]).call{value: values[i], gas: ETH_TRANSFER_GAS}("");
            if (success) {
                sent += values[i];
            } else {
                emit TransferFailed(address(0), recipients[i], values[i]);
            }
        }

        _payFee(feeAmount);
        _refund(msg.value - feeAmount - sent);

        emit Dispersed(address(0), msg.sender, recipients.length, sent);
    }

    /**
     * @notice Distributes tokens directly from the sender, who must have approved the total.
     *         With a fee-on-transfer token every recipient receives the amount minus the token's fee.
     * @param token       ERC-20 token contract.
     * @param recipients  Destination addresses.
     * @param values      Token amounts (smallest unit) for each recipient.
     * @param feeAmount   Service fee in wei, at least MIN_FEE, paid from msg.value. Overpayment is refunded.
     */
    function disperseToken(
        IERC20 token,
        address[] calldata recipients,
        uint256[] calldata values,
        uint256 feeAmount
    ) external payable nonReentrant {
        _checkLengths(recipients.length, values.length);
        require(feeAmount >= MIN_FEE, "Fee too low");
        require(msg.value >= feeAmount, "Insufficient ETH for fee");
        require(address(token).code.length > 0, "Token is not a contract");

        /* Checked up front: otherwise every transfer would be skipped and the sender would still pay the fee. */
        uint256 total = _sum(values);
        require(token.allowance(msg.sender, address(this)) >= total, "Insufficient allowance");
        require(token.balanceOf(msg.sender) >= total, "Insufficient balance");

        uint256 sent = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            _requireGasFor(TOKEN_TRANSFER_GAS);
            if (_tryTransferFrom(token, msg.sender, recipients[i], values[i])) {
                sent += values[i];
            } else {
                emit TransferFailed(address(token), recipients[i], values[i]);
            }
        }

        _payFee(feeAmount);
        _refund(msg.value - feeAmount);

        emit Dispersed(address(token), msg.sender, recipients.length, sent);
    }

    function _checkLengths(uint256 recipientCount, uint256 valueCount) private pure {
        require(recipientCount == valueCount, "Length mismatch");
        require(recipientCount <= MAX_RECIPIENTS, "Too many recipients");
    }

    function _sum(uint256[] calldata values) private pure returns (uint256 total) {
        for (uint256 i = 0; i < values.length; i++) {
            total += values[i];
        }
    }

    /**
     * @dev A call receives at most 63/64 of the remaining gas. Without this check a low gas limit could
     *      make a transfer fail and be reported as the recipient's failure. Now the whole transaction reverts.
     */
    function _requireGasFor(uint256 transferGas) private view {
        require(gasleft() > transferGas + transferGas / 63 + GAS_RESERVE, "Insufficient gas");
    }

    /// @dev Reads at most 32 bytes of return data, so a token cannot make this contract copy a huge response.
    function _tryTransferFrom(IERC20 token, address from, address to, uint256 value) private returns (bool success) {
        bytes memory data = abi.encodeCall(IERC20.transferFrom, (from, to, value));
        uint256 gasLimit = TOKEN_TRANSFER_GAS;

        assembly ("memory-safe") {
            mstore(0x00, 0)
            success := call(gasLimit, token, 0, add(data, 0x20), mload(data), 0x00, 0x20)
            /* Tokens like USDT return nothing; all others must return true. */
            if success {
                if returndatasize() {
                    success := and(gt(returndatasize(), 0x1f), eq(mload(0x00), 1))
                }
            }
        }
    }

    function _payFee(uint256 feeAmount) private {
        (bool success, ) = feeWallet.call{value: feeAmount}("");
        require(success, "Fee transfer failed");
    }

    function _refund(uint256 amount) private {
        if (amount > 0) {
            (bool success, ) = payable(msg.sender).call{value: amount}("");
            require(success, "Refund failed");
        }
    }
}
