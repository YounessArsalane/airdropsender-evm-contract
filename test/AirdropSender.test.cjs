const {expect} = require('chai');
const {ethers} = require('hardhat');

const randomAddresses = (count) => Array.from({length: count}, () => ethers.Wallet.createRandom().address);
const deploy = async (name, ...args) => (await ethers.getContractFactory(name)).deploy(...args);
const sum = (values) => values.reduce((total, value) => total + value, 0n);
const mined = async (tx) => (await tx).wait();

describe('AirdropSender', function () {
    this.timeout(300000);

    let owner, feeWallet, contract;
    const feeFor = (count) => ethers.parseEther('0.0001') * BigInt(count);

    beforeEach(async () => {
        [owner, , feeWallet] = await ethers.getSigners();
        contract = await deploy('AirdropSender', feeWallet.address);
    });

    describe('deployment', () => {
        it('rejects the zero address as fee wallet', async () => {
            await expect(deploy('AirdropSender', ethers.ZeroAddress)).to.be.revertedWith('Invalid fee wallet');
        });

        it('stores the fee wallet', async () => {
            expect(await contract.feeWallet()).to.equal(feeWallet.address);
        });
    });

    describe('disperseEther', () => {
        it('pays every recipient and the fee wallet', async () => {
            const recipients = randomAddresses(3), values = [1n, 2n, 3n], fee = feeFor(3);
            const before = await ethers.provider.getBalance(feeWallet.address);

            await expect(contract.disperseEther(recipients, values, fee, {value: fee + 6n}))
                .to.emit(contract, 'Dispersed').withArgs(ethers.ZeroAddress, owner.address, 3n, 6n);

            for (let i = 0; i < 3; i++) expect(await ethers.provider.getBalance(recipients[i])).to.equal(values[i]);
            expect(await ethers.provider.getBalance(feeWallet.address) - before).to.equal(fee);
        });

        it('refunds overpayment and keeps nothing', async () => {
            const recipient = randomAddresses(1);
            await contract.disperseEther(recipient, [1n], 1n, {value: ethers.parseEther('1') + 1n});
            expect(await ethers.provider.getBalance(contract.target)).to.equal(0n);
        });

        it('rejects too little ETH, different lengths and too many recipients', async () => {
            const recipients = randomAddresses(2);
            await expect(contract.disperseEther(recipients, [1n, 1n], 5n, {value: 2n})).to.be.revertedWith('Insufficient ETH');
            await expect(contract.disperseEther(recipients, [1n], 1n, {value: 1n + 1n})).to.be.revertedWith('Length mismatch');
            const tooMany = randomAddresses(401);
            await expect(contract.disperseEther(tooMany, tooMany.map(() => 0n), 0)).to.be.revertedWith('Too many recipients');
        });

        it('skips recipients that refuse ETH and refunds their amount', async () => {
            const refusing = await deploy('RevertRecv'), expensive = await deploy('StorageRecv'), logging = await deploy('LogRecv');
            const wallet = randomAddresses(1)[0];
            const recipients = [wallet, refusing.target, expensive.target, logging.target];

            await expect(contract.disperseEther(recipients, recipients.map(() => 1000n), 1n, {value: 4000n + 1n}))
                .to.emit(contract, 'Dispersed').withArgs(ethers.ZeroAddress, owner.address, 4n, 2000n)
                .and.to.emit(contract, 'TransferFailed').withArgs(ethers.ZeroAddress, refusing.target, 1000n)
                .and.to.emit(contract, 'TransferFailed').withArgs(ethers.ZeroAddress, expensive.target, 1000n);

            expect(await ethers.provider.getBalance(wallet)).to.equal(1000n);
            expect(await ethers.provider.getBalance(refusing.target)).to.equal(0n);
            expect(await ethers.provider.getBalance(expensive.target)).to.equal(0n);
            expect(await ethers.provider.getBalance(logging.target)).to.equal(1000n);
            expect(await ethers.provider.getBalance(contract.target)).to.equal(0n);
        });

        it('rejects a fee below the minimum and pays the minimum to the fee wallet', async () => {
            expect(await contract.MIN_FEE()).to.equal(1n);
            await expect(contract.disperseEther(randomAddresses(1), [1n], 0, {value: 1n})).to.be.revertedWith('Fee too low');

            const before = await ethers.provider.getBalance(feeWallet.address);
            await contract.disperseEther(randomAddresses(1), [1n], 1n, {value: 2n});
            expect(await ethers.provider.getBalance(feeWallet.address)).to.equal(before + 1n);
        });

        it('MAX_RECIPIENTS new ETH addresses fit in one transaction', async () => {
            const recipients = randomAddresses(400);
            const receipt = await mined(contract.disperseEther(recipients, recipients.map(() => 1n), 1n, {value: 400n + 1n}));
            expect(receipt.gasUsed).to.be.below(16_777_216n);
            expect(await ethers.provider.getBalance(recipients[399])).to.equal(1n);
        });

        it('a recipient cannot reenter', async () => {
            const attacker = await deploy('ReenterEth', contract.target);
            const others = randomAddresses(2), recipients = [attacker.target, ...others];
            await contract.disperseEther(recipients, recipients.map(() => 1000n), 1n, {value: 3000n + 1n});
            expect(await attacker.result()).to.equal(2n);
            for (const other of others) expect(await ethers.provider.getBalance(other)).to.equal(1000n);
            expect(await ethers.provider.getBalance(contract.target)).to.equal(0n);
        });

        it('reverts on a low gas limit instead of blaming recipients', async () => {
            const recipients = randomAddresses(50);
            await expect(contract.disperseEther(recipients, recipients.map(() => 1n), 1n, {value: 50n + 1n, gasLimit: 500_000})).to.be.rejected;
            expect(await ethers.provider.getBalance(recipients[0])).to.equal(0n);
        });
    });

    describe('disperseToken', () => {
        it('pays every recipient and the fee wallet', async () => {
            const token = await deploy('Std'), recipients = randomAddresses(3), values = [1n, 2n, 3n], fee = feeFor(3);
            const before = await ethers.provider.getBalance(feeWallet.address);
            await token.approve(contract.target, 6n);

            await expect(contract.disperseToken(token.target, recipients, values, fee, {value: fee}))
                .to.emit(contract, 'Dispersed').withArgs(token.target, owner.address, 3n, 6n);

            for (let i = 0; i < 3; i++) expect(await token.balanceOf(recipients[i])).to.equal(values[i]);
            expect(await token.balanceOf(contract.target)).to.equal(0n);
            expect(await token.allowance(owner.address, contract.target)).to.equal(0n);
            expect(await ethers.provider.getBalance(feeWallet.address) - before).to.equal(fee);
        });

        it('refunds ETH above the fee', async () => {
            const token = await deploy('Std');
            await token.approve(contract.target, 1n);
            await contract.disperseToken(token.target, randomAddresses(1), [1n], 1n, {value: ethers.parseEther('1') + 1n});
            expect(await ethers.provider.getBalance(contract.target)).to.equal(0n);
        });

        it('never holds tokens: they go directly from the sender to the recipient', async () => {
            const token = await deploy('Std'), [recipient] = randomAddresses(1);
            await token.approve(contract.target, 5n);
            await expect(contract.disperseToken(token.target, [recipient], [5n], 1n, {value: 1n}))
                .to.emit(token, 'Transfer').withArgs(owner.address, recipient, 5n);
            expect(await token.balanceOf(contract.target)).to.equal(0n);
        });

        it('rejects bad input before charging anything', async () => {
            const token = await deploy('Std'), recipient = randomAddresses(1);
            await expect(contract.disperseToken(token.target, recipient, [1n], 0)).to.be.revertedWith('Fee too low');
            await expect(contract.disperseToken(token.target, recipient, [1n], 5n, {value: 1n})).to.be.revertedWith('Insufficient ETH for fee');
            await expect(contract.disperseToken(token.target, recipient, [1n], 1n, {value: 1n})).to.be.revertedWith('Insufficient allowance');
            await expect(contract.disperseToken(owner.address, recipient, [1n], 1n, {value: 1n})).to.be.revertedWith('Token is not a contract');

            const huge = 10n ** 31n;
            await token.approve(contract.target, huge);
            await expect(contract.disperseToken(token.target, recipient, [huge], 1n, {value: 1n})).to.be.revertedWith('Insufficient balance');
        });

        it('handles tokens without return values and refunds a blocked recipient', async () => {
            const token = await deploy('UsdtLike'), recipients = randomAddresses(3);
            const before = await token.balanceOf(owner.address);
            await token.approve(contract.target, 60n);
            await token.setBlack(recipients[1]);

            await expect(contract.disperseToken(token.target, recipients, [10n, 20n, 30n], 1n, {value: 1n}))
                .to.emit(contract, 'Dispersed').withArgs(token.target, owner.address, 3n, 40n)
                .and.to.emit(contract, 'TransferFailed').withArgs(token.target, recipients[1], 20n);

            expect(await token.balanceOf(recipients[1])).to.equal(0n);
            expect(before - await token.balanceOf(owner.address)).to.equal(40n);
        });

        it('skips transfers that return false', async () => {
            const token = await deploy('BoolFalse'), recipients = randomAddresses(2);
            await token.setBad(recipients[0]);
            await token.approve(contract.target, 30n);
            await contract.disperseToken(token.target, recipients, [10n, 20n], 1n, {value: 1n});
            expect(await token.balanceOf(recipients[0])).to.equal(0n);
            expect(await token.balanceOf(recipients[1])).to.equal(20n);
            expect(await token.balanceOf(contract.target)).to.equal(0n);
        });

        it('with a fee-on-transfer token every recipient receives the amount minus the fee', async () => {
            const token = await deploy('Fot'), recipients = randomAddresses(4);
            const before = await token.balanceOf(owner.address);
            await token.approve(contract.target, 4000n);

            await expect(contract.disperseToken(token.target, recipients, recipients.map(() => 1000n), 1n, {value: 1n}))
                .to.emit(contract, 'Dispersed').withArgs(token.target, owner.address, 4n, 4000n);

            for (const recipient of recipients) expect(await token.balanceOf(recipient)).to.equal(990n);
            expect(before - await token.balanceOf(owner.address)).to.equal(4000n);
        });

        it('a reentering recipient cannot take tokens of the running airdrop', async () => {
            const token = await deploy('HookToken');
            const attacker = await deploy('Reenter', contract.target, token.target);
            const others = randomAddresses(3), recipients = [attacker.target, ...others];
            await token.approve(contract.target, 4000n);

            await contract.disperseToken(token.target, recipients, recipients.map(() => 1000n), 1n, {value: 1n});

            expect(await attacker.grabbed()).to.equal(2n);
            expect(await token.balanceOf(attacker.target)).to.equal(1000n);
            for (const other of others) expect(await token.balanceOf(other)).to.equal(1000n);
        });

        it('a gas-burning recipient of a hook token does not stop the others', async () => {
            const token = await deploy('HookToken'), burner = await deploy('GasBurner');
            const first = randomAddresses(1)[0], others = randomAddresses(2);
            const recipients = [first, burner.target, ...others], values = recipients.map(() => 1000n);
            await token.approve(contract.target, 4000n);
            const gasLimit = await contract.disperseToken.estimateGas(token.target, recipients, values, 1n, {value: 1n});

            await mined(contract.disperseToken(token.target, recipients, values, 1n, {value: 1n, gasLimit: gasLimit * 130n / 100n}));

            expect(await token.balanceOf(first)).to.equal(1000n);
            for (const other of others) expect(await token.balanceOf(other)).to.equal(1000n);
        });

        it('a token returning a huge response counts as failed and cannot exhaust the transaction', async () => {
            const token = await deploy('ReturnBomb'), recipients = randomAddresses(3);
            await expect(contract.disperseToken(token.target, recipients, [1n, 1n, 1n], 1n, {value: 1n}))
                .to.emit(contract, 'Dispersed').withArgs(token.target, owner.address, 3n, 3n);
        });

        it('reverts on a low gas limit instead of blaming recipients', async () => {
            const token = await deploy('Std'), recipients = randomAddresses(50);
            await token.approve(contract.target, 50n);
            await expect(contract.disperseToken(token.target, recipients, recipients.map(() => 1n), 1n, {value: 1n, gasLimit: 500_000})).to.be.rejected;
            expect(await token.balanceOf(recipients[0])).to.equal(0n);
        });
    });

    describe('gas per recipient (upper bounds, compare with REPORT_GAS=true)', () => {
        const perRecipient = (receipt, count) => Number(receipt.gasUsed) / count;

        it('ETH', async () => {
            const recipients = randomAddresses(100), values = recipients.map(() => 1000n), value = sum(values);
            const fresh = await mined(contract.disperseEther(recipients, values, 1n, {value: value + 1n}));
            const existing = await mined(contract.disperseEther(recipients, values, 1n, {value: value + 1n}));
            expect(perRecipient(fresh, 100)).to.be.below(37_000);
            expect(perRecipient(existing, 100)).to.be.below(12_000);
        });

        it('token', async () => {
            const token = await deploy('Std'), recipients = randomAddresses(100), values = recipients.map(() => 1000n);
            await token.approve(contract.target, ethers.MaxUint256);
            const fresh = await mined(contract.disperseToken(token.target, recipients, values, 1n, {value: 1n}));
            const existing = await mined(contract.disperseToken(token.target, recipients, values, 1n, {value: 1n}));
            expect(perRecipient(fresh, 100)).to.be.below(32_000);
            expect(perRecipient(existing, 100)).to.be.below(15_000);
        });

        it('the UI batch sizes fit in one transaction', async () => {
            const ethRecipients = randomAddresses(200);
            const eth = await mined(contract.disperseEther(ethRecipients, ethRecipients.map(() => 1n), 1n, {value: 200n + 1n}));
            expect(eth.gasUsed).to.be.below(16_777_216n * 100n / 130n);

            const token = await deploy('Std'), tokenRecipients = randomAddresses(100);
            await token.approve(contract.target, ethers.MaxUint256);
            const erc20 = await mined(contract.disperseToken(token.target, tokenRecipients, tokenRecipients.map(() => 1n), 1n, {value: 1n}));
            expect(erc20.gasUsed).to.be.below(16_777_216n * 100n / 130n);
        });
    });
});
