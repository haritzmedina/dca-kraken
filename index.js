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

const crypto = require('crypto');
const Decimal = require('decimal.js');

const simulator = process.env.SIMULATOR === 'true';
const baseUrl = 'https://api.kraken.com'; // Always use live for public data, dry-run skips orders

console.log(simulator ? 'Using Kraken API in dry-run mode (no orders placed)' : 'Using Kraken Live API');

async function publicApi(method, params = {}) {
    const url = new URL(`${baseUrl}/0/public/${method}`);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    const response = await fetch(url);
    return response.json();
}

function getSignature(path, data, secret) {
    const postData = new URLSearchParams(data).toString();
    const message = data.nonce + postData;
    
    // Hash SHA256 del nonce + postData
    const hash = crypto.createHash('sha256').update(message).digest('binary');
    
    const secretBuffer = Buffer.from(secret, 'base64');
    const hmac = crypto.createHmac('sha512', secretBuffer);
    
    // Kraken requiere: HMAC-SHA512 de (path + SHA256(nonce + postData))
    // Nota el uso de Buffer.concat para unir el path y el hash binario
    const hmacDigest = hmac.update(Buffer.concat([Buffer.from(path), Buffer.from(hash, 'binary')])).digest('base64');
    
    return hmacDigest;
}

async function privateApi(method, params = {}) {
    const path = `/0/private/${method}`;
    const nonce = Date.now();
    const data = { nonce, ...params };
    
    const signature = getSignature(path, data, process.env.SECRET);
    
    const formData = new URLSearchParams(data);

    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'API-Key': process.env.KEY,
            'API-Sign': signature,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: formData.toString()
    });
    
    return response.json();
}

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
        const historicalData = await publicApi('OHLC', { pair, interval, since })
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
        if (quantity_first && !isNaN(quantity_first)) {
            volume = quantity_first
        } else {
            volume = parseFloat(quantity_second) / parseFloat(price)
        }

        // Truncate price and volume based on permitted by kraken
        const data = await publicApi('AssetPairs');
        const pairInfo = data.result[pair];
        price = parseFloat(price).toFixed(pairInfo.pair_decimals);
        volume = parseFloat(volume).toFixed(pairInfo.lot_decimals);

        const orderParams = {
            pair,
            type: 'buy',
            ordertype: 'limit',
            price: price,
            volume: volume, // aquí se puede ajustar el volumen a comprar
          };

        if (simulator) {
            console.log('Dry-run mode: Order would be placed with params:', orderParams);
        } else {
            const orderResponse = await privateApi('AddOrder', orderParams);
            console.log('Full response:', JSON.stringify(orderResponse, null, 2));
            if (orderResponse.error && orderResponse.error.length > 0) {
                console.log('API Error:', orderResponse.error);
            }
            const orderInfo = JSON.stringify(orderResponse)
                .replace(/[{}]/g, '')
                .replace(/":/g, ':')
                .replace(/,"/g, ',')
                .replace(/"/g, '')
            console.log(`Order placed: ${orderInfo}`);
        }

    } catch (e) {
        console.error(e)
    }
}

main().catch()