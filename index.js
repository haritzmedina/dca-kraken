require('dotenv').config({path : process.argv.slice(2)[0]})

const types = {
    current: 'CURRENT',
    lowest: 'LOWEST',
    mean: 'VWAP_MEAN',
    average: 'CLOSE_AVERAGE'
}

const type = process.env.TYPE || 'CURRENT'

const pair = process.env.PAIR
const quantity_first = parseFloat(process.env.QUANTITY_FIRST)
const quantity_second = parseFloat(process.env.QUANTITY_SECOND)
const days = process.env.DAYS || 1
const interval = 1440 // Tune this to possible values, but 1440 works the best: 1 5 15 30 60 240 1440 10080 21600 minutes, take care because VWAP_MEAN changes by changing this value

const KrakenClient = require('kraken-api');
const Decimal = require('decimal.js');

const kraken = new KrakenClient(process.env.KEY, process.env.SECRET);

let rounder = (num, places, mode) => {
    // (A1) MULTIPLIER
    let mult = parseInt("1" + "0".repeat(places));
    num = num * mult;

    // (A2) ROUND OFF
    if (mode === 1) { num = Math.ceil(num); }
    else if (mode === 0) { num = Math.floor(num); }
    else { num = Math.round(num); }

    // (A3) RETURN RESULTS
    return num / mult;
}


let main = async () => {
    try {
        const since = Math.floor((Date.now() / 1000) - (interval * parseInt(days) * 60));
        const historicalData = await kraken.api('OHLC', { pair, interval, since })
        const ohlcData = historicalData.result[pair]
        const lastOHLC = ohlcData[ohlcData.length - 1]
        const last2WeeksData = historicalData.result[pair];
        const lowestPrice = Math.min(...last2WeeksData.map(data => data[3])); // se usa el precio más bajo (índice 3) en los últimos 14 días
        const meanPrice = last2WeeksData.reduce((sum, data) => {
            const closePrice = new Decimal(data[5]);
            return sum.plus(closePrice);
          }, new Decimal(0)).dividedBy(last2WeeksData.length).toFixed(2);
          const averagePrice = last2WeeksData.reduce((sum, data) => {
            const closePrice = new Decimal(data[4]);
            return sum.plus(closePrice);
          }, new Decimal(0)).dividedBy(last2WeeksData.length).toFixed(2);
        const currentPrice = lastOHLC[4]

        let price
        if (type === types.current) {
            price = currentPrice
        } else if (type === types.lowest) {
            price = lowestPrice
        } else if (type === types.mean) {
            price = meanPrice
        } else if (type === types.average) {
            price = averagePrice
        }

        if (process.env.LESS_PERCENTAGE) {
            price = price - price*parseFloat(process.env.LESS_PERCENTAGE)
        }

        let volume
        if (quantity_first === '') {
            volume = quantity_first
        } else if (typeof quantity_second === 'number') {
            volume = (parseFloat(quantity_second)/parseFloat(price))
        }

        // Truncate price and volume based on permitted by kraken
        const data = await kraken.api('AssetPairs');

        const orderParams = {
            pair,
            type: 'buy',
            ordertype: 'limit',
            price: price.toFixed(data.result[pair].pair_decimals).toString(),
            volume: volume, // aquí se puede ajustar el volumen a comprar
          };

        const orderResponse = await kraken.api('AddOrder', orderParams);
        const orderInfo = JSON.stringify(orderResponse)
            .replace(/[{}]/g, '')
            .replace(/":/g, ':')
            .replace(/,"/g, ',')
            .replace(/"/g, '')
        console.log(`Order placed: ${orderInfo}`);

    } catch (e) {
        console.error(e)
    }
}

main().catch()