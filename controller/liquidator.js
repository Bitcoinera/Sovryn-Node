/**
 * Liquidation handler
 * If liquidation is successful removes position from liquidation list
 * If it fails, check if the liquidation criteria are still met.
 * If no, delete it from the liquidation list. If yes, send an error notification to a telegram group for manual processing.
 */

import C from './contract';
import U from '../util/helper';
import Wallet from './wallet';
import Arbitrage from '../controller/arbitrage';
import conf from '../config/config';
import common from './common'
import abiDecoder from 'abi-decoder';
import abiComplete from "../config/abiComplete";
import Extra from 'telegraf/extra';
import dbCtrl from './db';

class Liquidator {
    constructor() {
        this.liquidationErrorList=[];
        abiDecoder.addABI(abiComplete);
    }

    start(liquidations) {
        this.liquidations = liquidations;
        this.checkPositionsForLiquidations();
    }

    /**
     * Wrapper for liquidations
     * 1. Get a wallet with enough funds in required tokens and which is not busy at the moment, then
     * 2. Try to liquidate position
     */
    async checkPositionsForLiquidations() {
        while (true) {
            await this.handleLiquidationRound();
            console.log("Completed liquidation round");
            await U.wasteTime(conf.liquidatorScanInterval);
        }
    }

    async handleLiquidationRound() {
        console.log("started liquidation round");
        console.log(Object.keys(this.liquidations).length + " positions need to be liquidated");

        for (let p in this.liquidations) {
            const pos = this.liquidations[p];
            const token = pos.loanToken.toLowerCase() === conf.testTokenRBTC ? "rBtc" : pos.loanToken;

            //Position already in liquidation wallet-queue
            if (Wallet.checkIfPositionExists(p)) continue;
            //failed too often -> have to check manually
            if(this.liquidationErrorList[p]>=5) continue;

            const [wallet, wBalance] = await Wallet.getWallet("liquidator", pos.maxLiquidatable, token);
            if (!wallet) {
                await this.handleNoWalletError(p);
                continue;
            }

            const liquidateAmount = await this.calculateLiquidateAmount(wBalance, pos, token, wallet)
            if (!liquidateAmount) return;

            const nonce = await C.web3.eth.getTransactionCount(wallet.adr, 'pending');

            await this.liquidate(p, wallet.adr, liquidateAmount, token, pos.collateralToken, nonce);
            await U.wasteTime(30); //30 seconds break to avoid rejection from node
        }
    }

    async calculateLiquidateAmount(wBalance, pos, token, wallet) {
        let liquidateAmount = Math.min(parseInt(pos.maxLiquidatable), wBalance);
        const gasPrice = await C.getGasPrice();
        const toBN = C.web3.utils.toBN;
        const rbtcBalance = toBN(await C.web3.eth.getBalance(wallet.adr));
        const txFees = toBN(conf.gasLimit).mul(toBN(gasPrice));
        if (pos.maxLiquidatable < wBalance && txFees.lt(rbtcBalance)) {
            console.log("enough balance on wallet");
        } else if (wBalance === 0) {
            console.log("not enough balance on wallet");
            return;
        } else {
            if (token === "rBtc") {
                liquidateAmount = toBN(wBalance).sub(toBN(txFees)).toNumber();
            }
            if (liquidateAmount <= 0) {
                console.log("not enough balance on wallet");
                return;
            }
            if (txFees.gt(rbtcBalance)) {
                console.log("not enough RBTC balance on wallet to pay fees");
                return;
            }
            console.log("not enough balance on wallet. only use "+liquidateAmount);
        }
        return liquidateAmount;
    }

    /**
    * swaps back to collateral currency after liquidation is completed
    * @param value should be sent in Wei format as String
    * @param sourceCurrency should be that hash of the contract
    * @param destCurrency is defaulting for now to 'rbtc'
    */
    async swapBackAfterLiquidation(value, sourceCurrency, destCurrency = 'rbtc', wallet) {
        sourceCurrency = sourceCurrency === 'rbtc' ? sourceCurrency : C.getTokenSymbol(sourceCurrency);
        destCurrency = destCurrency === 'rbtc' ? destCurrency : C.getTokenSymbol(destCurrency);
        console.log(`Swapping back ${value} ${sourceCurrency} to ${destCurrency}`);
        try {
            const prices = await Arbitrage.getRBtcPrices();
            const tokenPriceInRBtc = prices[sourceCurrency];
            if (!tokenPriceInRBtc) throw "No prices found for the " + sourceCurrency + " token";
            const res = await Arbitrage.swap(value, sourceCurrency, destCurrency, wallet);
            if (res) console.log("Swap successful!");
        } catch(err) {
            console.log("Swap failed", err);
        }
    }

    /*
    * Tries to liquidate a position
    * If Loan token == WRBTC -> pass value
    * wallet = sender and receiver address
    */
    async liquidate(loanId, wallet, amount, token, collateralToken, nonce) {
        console.log("trying to liquidate loan " + loanId + " from wallet " + wallet + ", amount: " + amount);
        Wallet.addToQueue("liquidator", wallet, loanId);
        const val = (token === "rBtc") ? amount : 0;
        console.log("Sending val: " + val);
        console.log("Nonce: " + nonce);

        if (this.liquidations && this.liquidations.length > 0) {
            //delete position from liquidation queue, regardless of success or failure because in the latter case it gets added again anyway
            delete this.liquidations[loanId];
        }

        const p = this;
        const gasPrice = await C.getGasPrice();

        //wrong -> update
        const pos = token === conf.testTokenRBTC.toLowerCase() ? 'long' : 'short';

        return C.contractSovryn.methods.liquidate(loanId, wallet, amount.toString())
            .send({ from: wallet, gas: conf.gasLimit, gasPrice: gasPrice, nonce: nonce, value: val })
            .then(async (tx) => {
                console.log("loan " + loanId + " liquidated!");
                console.log(tx.transactionHash);
                await p.handleLiqSuccess(wallet, loanId, tx.transactionHash, amount, token);
                await p.addLiqLog(tx.transactionHash, pos);
                if (token !== "rBtc") await p.swapBackAfterLiquidation(amount.toString(), token.toLowerCase(), collateralToken.toLowerCase(), wallet);
            })
            .catch(async (err) => {
                console.error("Error on liquidating loan " + loanId);
                console.error(err);

                let errorDetails;
                if(err.receipt) {
                    errorDetails = `${conf.blockExplorer}tx/${err.receipt.transactionHash}`;
                } else {
                    errorDetails = err.toString().slice(0, 200);
                }
                common.telegramBot.sendMessage(
                    `<b><u>L</u></b>\t\t\t\t ⚠️<b>ERROR</b>⚠️\n Error on liquidation tx: ${errorDetails}\n` +
                    `LoanId: ${U.formatLoanId(loanId)}`,
                    Extra.HTML()
                );
                await p.handleLiqError(wallet, loanId, amount, pos);
            });
    }

    async handleLiqSuccess(wallet, loanId, txHash, amount, token) {
        Wallet.removeFromQueue("liquidator", wallet, loanId);
        this.liquidationErrorList[loanId]=null;
        const msg = `<b><u>L</u></b>\t\t\t\t ${conf.network} net-liquidation of loan ${U.formatLoanId(loanId)} of ${amount} ${C.getTokenSymbol(token).toUpperCase()} successful. 
            \n${conf.blockExplorer}tx/${txHash}`;
        common.telegramBot.sendMessage(msg, Extra.HTML());
    }

    /**
     * Possible errors:
     * 1. Another user was faster -> position is already liquidated
     * 2. Btc price moved in opposite direction and the amount cannot be liquidated anymore
     */
    async handleLiqError(wallet, loanId, amount, pos) {
        Wallet.removeFromQueue("liquidator", wallet, loanId);
        if(!this.liquidationErrorList[loanId]) this.liquidationErrorList[loanId]=1;
        else this.liquidationErrorList[loanId]++;

        console.log('Storing failed transaction into DB');
        // store failed transaction in DB
        await dbCtrl.addLiquidate({
            liquidatorAdr: wallet,
            amount,
            loanId,
            status: 'failed',
            pos
        });
        const updatedLoan = await C.getPositionStatus(loanId)
        if (updatedLoan.maxLiquidatable > 0) {
            console.log("loan " + loanId + " should still be liquidated. Please check manually");
            common.telegramBot.sendMessage(`<b><u>L</u></b>\t\t\t\t ${conf.network} net-liquidation of loan ${U.formatLoanId(loanId)} failed.`, Extra.HTML());
        }
    }

    async handleNoWalletError(loanId) {
        console.error("Liquidation of loan " + loanId + " failed because no wallet with enough funds was available");
        common.telegramBot.sendMessage(`<b><u>L</u></b>\t\t\t\t ${conf.network} net-liquidation of loan ${U.formatLoanId(loanId)} failed because no wallet with enough funds was found.`, Extra.HTML());
    }

    async calculateLiqProfit(liqEvent) {
        console.log("Calculate profit for liquidation", liqEvent.loanId);
        // To calculate the profit from a liquidation we need to get the difference between the amount we deposit in the contract, repayAmount,
        // and the amount we get back, collateralWithdrawAmount. But to do this we need to convert both to the same currency
        // Convert spent amount to collateral token 
        const convertedPaidAmount = await Arbitrage.getPriceFromPriceFeed(C.contractPriceFeed, liqEvent.loanToken, liqEvent.collateralToken, liqEvent.repayAmount);
        if (convertedPaidAmount) {
            const liqProfit = Number(C.web3.utils.fromWei(
                C.web3.utils.toBN(liqEvent.collateralWithdrawAmount).sub(C.web3.utils.toBN(convertedPaidAmount))
            , "Ether")).toFixed(6);
            console.log(`You made ${liqProfit} ${C.getTokenSymbol(liqEvent.collateralToken).toUpperCase()} with this liquidation`);
            return liqProfit+" "+C.getTokenSymbol(liqEvent.collateralToken).toUpperCase();
        }
        else {
            console.log("Couldn't calculate the profit for the given liquidation");
        }
    }

    async addLiqLog(txHash, pos) {
        console.log("Add liquidation "+txHash+" to db");
        try {
            const receipt = await C.web3.eth.getTransactionReceipt(txHash);
            
            if (receipt && receipt.logs) {
                const logs = abiDecoder.decodeLogs(receipt.logs) || [];
                const liqEvent = logs.find(log => log && log.name === 'Liquidate');
                console.log(liqEvent)
                const {
                    user, liquidator, loanId, loanToken, collateralWithdrawAmount
                } = U.parseEventParams(liqEvent && liqEvent.events);

                console.log(U.parseEventParams(liqEvent && liqEvent.events))

                if (user && liquidator && loanId) {
                    console.log("user found");
                    console.log(user);
                    console.log(liquidator);
                    console.log(loanId);

                    const profit = await this.calculateLiqProfit(U.parseEventParams(liqEvent && liqEvent.events))

                    const addedLog = await dbCtrl.addLiquidate({
                        liquidatorAdr: liquidator,
                        liquidatedAdr: user,
                        amount: collateralWithdrawAmount,
                        loanId: loanId,
                        profit: profit,
                        txHash: txHash,
                        status: 'successful',
                        pos
                    });

                    return addedLog;
                }
            }

        } catch (e) {
            console.error(e);
        }
    }
}

export default new Liquidator();
