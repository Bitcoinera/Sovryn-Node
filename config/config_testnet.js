import {errorBotNodeTelegramToken, errorBotWatcherTelegramToken} from '../secrets/telegram';

export default  {
    serverPort: 3000,
    nodeProvider: 'https://testnet.sovryn.app/rpc', 
    publicNodeProvider: 'https://public-node.testnet.rsk.co', 
    network: "test",
    nrOfProcessingPositions: 10, //need to find appropriate nr
    waitBetweenRounds: 60, //in seconds
    testTokenRBTC: "0x69FE5cEC81D5eF92600c1A0dB1F11986AB3758Ab", //wrbtc
    loanTokenSUSD: "0x543B6777A13e1fBBF8abaF08692F0Ad67cA352Fc", //underlying token = doc
    loanTokenRBTC: "0xb01f116199C5eE8e2977b0a9280fE392c4162838",
    docToken: "0xCB46c0ddc60D18eFEB0E586C17Af6ea36452Dae0", //former susd
    sovrynProtocolAdr: "0x217d65Efe40e2d396519C9d094a6Cc87F5B8670b",
    errorBotNodeTelegramToken: errorBotNodeTelegramToken,
    errorBotWatcherTelegramToken: errorBotWatcherTelegramToken,
    sovrynInternalTelegramId: -1001308978723,
    healthMonitorPort: 3 //results in 3003
}