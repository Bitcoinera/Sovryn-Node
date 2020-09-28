/** 
* This contracts contain a custom price feed which is arbitrarily settable
* does not take price from oracles
*/

import {errorBotNodeTelegramToken, errorBotWatcherTelegramToken} from '../secrets/telegram';

export default  {
    serverPort: 3000,
    nodeProvider: 'https://testnet.sovryn.app/rpc', 
    publicNodeProvider: 'https://public-node.testnet.rsk.co', 
    network: "test",
    nrOfProcessingPositions: 10, //need to find appropriate nr
    waitBetweenRounds: 60, //in seconds
    testTokenRBTC: "0x21Fa1095205a37aDe78F394B3B984ea3f743bc70", //wrbtc
    loanTokenSUSD: "0x4a050817d9192A4E4a093ea6426D53417c5Eb1FC", //underlying token = susd
    loanTokenRBTC: "0x021Bc6f3c101fC1354A212583a5aF0347FE283Cf",
    docToken: "0xD958866a46F4e7Db1Cc6A80589D0dc44Cbfb155b", //susd
    sovrynProtocolAdr: "0x6E2fb26a60dA535732F8149b25018C9c0823a715",
    errorBotNodeTelegramToken: errorBotNodeTelegramToken,
    errorBotWatcherTelegramToken: errorBotWatcherTelegramToken,
    sovrynInternalTelegramId: -1001308978723,
    healthMonitorPort: 3 //results in 3003
}