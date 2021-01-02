/**
 * Test the position scanner loop
 * Set config file in /config.config.js manually because mocha.js overwrites process.arg
*/
import abiComplete from '../config/abiComplete';
import PosScanner from '../controller/scanner';
import C from '../controller/contract';
import U from '../util/helper';
const assert = require('assert');
const abiDecoder = require('abi-decoder');
abiDecoder.addABI(abiComplete);

let positions = {}
let liquidations = {};

describe('Scanner', async () => {
    describe('#Open positions', async () => {
        before('init', async () => {
            PosScanner.positions=positions;
            PosScanner.liquidations=liquidations;
            PosScanner.positionsTmp={};
        });

        it('should find open positions on the Sovryn contract', async () => {
            let spread=100;
            let from = 0;
            let to = spread;
            let posFound=0;

            while (true) {
                const pos = await PosScanner.loadActivePositions(from, to);
                //console.log(pos);
                if (pos && pos.length > 0) {
                    console.log(pos.length + " active positions found");
                    PosScanner.addPosition(pos);
                    from = to;
                    to = from + spread;
                    posFound+=pos.length;
                    await U.wasteTime(1);
                }
                //reached current state
                else if(pos && pos.length==0) {
                    for (let k in PosScanner.positionsTmp) {
                        if (PosScanner.positionsTmp.hasOwnProperty(k)) {
                            positions[k] = JSON.parse(JSON.stringify(PosScanner.positionsTmp[k]));
                        }
                    }

                    console.log("Round ended. "+Object.keys(positions).length + " active positions found");
                    assert(Object.keys(positions).length==posFound);
                    break;
                }
                //error retrieving pos for this interval
                else {
                    console.log("error retrieving pos for this interval. continue")
                    from = to;
                    to = from + spread;
                    await U.wasteTime(1);
                }
            }
        });
        
        it('should find open positions with margin < 50%', async () => {
            for(let p in PosScanner.positions){
                //console.log(PosScanner.positions[p])
                let margin = PosScanner.positions[p].currentMargin/1e18;
                let mMargin = PosScanner.positions[p].maintenanceMargin/1e18;
                if(margin<70) console.log("Current margin: "+margin+" maintenance margin: "+mMargin+", loanId: "+p);
            }
        });

        /*
        it('should process all open pos', async () => {
            for(let p in PosScanner.positions){
                let ev = await loadEvent(p);  
                console.log(p+" "+ev.user);             
            }
            assert(true);
        });*/
    });
});




/*
**************************************************************************
********************helpers***********************************************
**************************************************************************
*/



/**
 * Parse the loan event log and returns the loan-id
 */
function parseLog(txHash) {
    console.log("parsing log");
    return new Promise(resolve => {
        C.web3.eth.getTransactionReceipt(txHash, function (e, receipt) {
            const decodedLogs = abiDecoder.decodeLogs(receipt.logs);

            for (let i = 0; i < decodedLogs.length; i++) {
                if (decodedLogs[i] && decodedLogs[i].events && decodedLogs[i].name && decodedLogs[i].name == "Borrow") {
                    //console.log(decodedLogs[i].events)
                    return resolve(decodedLogs[i].events[2].value);
                }
            }
        });
    });
}


function loadEvent(loanId) {
    return new Promise(resolve => {
        C.contractSovryn.getPastEvents('Trade', {
            fromBlock: 2742418,
            toBlock: 'latest',
            filter: {loanId: loanId}
        }, (error, events) => {
            if (error) {
                //console.log("had an error"); console.log(error);
                return resolve({});
            }
            //console.log(events[0].returnValues);
            //console.log(events[0]);
            if(events[0]&&events[0].returnValues) return resolve(events[0].returnValues);

            resolve({});
        });
    });
}