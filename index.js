#!/usr/bin/env node

require('dotenv').config({path : process.argv.slice(2)[0]})

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Decimal = require('decimal.js');

const types = {
    current: 'CURRENT',
    lowest: 'LOWEST',
    mean: 'VWAP_MEAN',
    average: 'CLOSE_AVERAGE'
}

const periodTypes = {
    WEEKLY: 'WEEKLY',
    BIWEEKLY: 'BIWEEKLY',
    MONTHLY: 'MONTHLY',
    TWO_TIMES_MONTH: '2_TIMES_MONTH',
    THREE_TIMES_MONTH: '3_TIMES_MONTH',
    FOUR_TIMES_MONTH: '4_TIMES_MONTH'
}

// Configuration from .env
const mode = process.env.MODE || 'SIMPLE'; // SIMPLE or SMART
const type = process.env.TYPE || 'CURRENT'
const pair = process.env.PAIR
const quantity_first = parseFloat(process.env.QUANTITY_FIRST)
const quantity_second = parseFloat(process.env.QUANTITY_SECOND)
const days = process.env.DAYS || 1
const interval = 1440 // Tune this to possible values, but 1440 works the best: 1 5 15 30 60 240 1440 10080 21600 minutes, take care because VWAP_MEAN changes by changing this value

// Smart DCA Configuration
const smartPeriod = process.env.SMART_PERIOD || '4_TIMES_MONTH';
const smartThreshold = parseFloat(process.env.SMART_THRESHOLD_PERCENT || '3');
const smartThresholds = process.env.SMART_THRESHOLDS || null; // Format: "1:25,3:25,5:25,10:25"
const smartFallbackHour = parseInt(process.env.SMART_FALLBACK_HOUR || '22');
const smartStateFile = process.env.SMART_STATE_FILE || './state.json';
const binanceCompare = process.env.BINANCE_COMPARE === 'true';
const binanceMaxDiff = parseFloat(process.env.BINANCE_MAX_DIFF_PERCENT || '0.5');

// Telegram Configuration
const telegramEnabled = process.env.TELEGRAM_ENABLED === 'true';
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

const simulator = process.env.SIMULATOR === 'true';
const baseUrl = 'https://api.kraken.com'; // Always use live for public data, dry-run skips orders

console.log(`Mode: ${mode} | ${simulator ? 'Dry-run (no orders)' : 'Live API'}`);

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

// ==================== TELEGRAM NOTIFICATIONS ====================

async function sendTelegram(message) {
    if (!telegramEnabled || !telegramBotToken || !telegramChatId) {
        return;
    }
    
    try {
        const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        
        if (!response.ok) {
            console.error('Failed to send Telegram notification');
        }
    } catch (e) {
        console.error('Telegram error:', e.message);
    }
}

// ==================== BINANCE PRICE COMPARISON ====================

async function getBinancePrice(symbol) {
    try {
        // Convert pair format: XXBTZEUR -> BTCEUR
        let binanceSymbol = symbol.replace('XXB', '').replace('XBT', 'BTC');
        
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.price) {
            return parseFloat(data.price);
        }
        return null;
    } catch (e) {
        console.error('Error fetching Binance price:', e.message);
        return null;
    }
}

async function comparePrices(krakenPrice) {
    if (!binanceCompare) {
        return { shouldWait: false, diff: 0 };
    }
    
    const binancePrice = await getBinancePrice(pair);
    
    if (!binancePrice) {
        console.log('⚠️  Could not fetch Binance price, proceeding with Kraken...');
        return { shouldWait: false, diff: 0 };
    }
    
    const diffPercent = ((krakenPrice - binancePrice) / binancePrice) * 100;
    
    console.log(`Price comparison: Kraken ${krakenPrice} vs Binance ${binancePrice} (${diffPercent.toFixed(2)}%)`);
    
    if (diffPercent > binanceMaxDiff) {
        const message = `⚠️ <b>Kraken Premium Alert</b>\n\nKraken: ${krakenPrice}€\nBinance: ${binancePrice}€\nDifference: +${diffPercent.toFixed(2)}%\n\n⏸️ Waiting for better price...`;
        await sendTelegram(message);
        return { shouldWait: true, diff: diffPercent, binancePrice };
    }
    
    return { shouldWait: false, diff: diffPercent, binancePrice };
}

// ==================== THRESHOLD PARSING ====================

function parseThresholds() {
    if (!smartThresholds) {
        // Legacy mode: single threshold
        return [{ percent: smartThreshold, budget: 100 }];
    }
    
    // Parse format: "1:25,3:25,5:25,10:25"
    const parts = smartThresholds.split(',');
    return parts.map(part => {
        const [percent, budget] = part.split(':').map(p => parseFloat(p.trim()));
        return { percent, budget };
    }).sort((a, b) => a.percent - b.percent); // Sort by threshold ascending
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

// ==================== STATE MANAGEMENT ====================

function loadState() {
    try {
        if (fs.existsSync(smartStateFile)) {
            const data = fs.readFileSync(smartStateFile, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error loading state file:', e.message);
    }
    return null;
}

function saveState(state) {
    try {
        fs.writeFileSync(smartStateFile, JSON.stringify(state, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Error saving state file:', e.message);
        return false;
    }
}

function initializeState() {
    return {
        version: '2.0',
        pair: pair,
        lastPurchase: null,
        pendingFallbackPurchase: false,
        executedThresholds: [], // Track which thresholds were triggered this period
        purchaseHistory: [], // Full history of all purchases
        config: {
            period: smartPeriod,
            thresholds: smartThresholds || `${smartThreshold}:100`,
            fallbackHour: smartFallbackHour
        }
    };
}

// ==================== PERIOD CALCULATIONS ====================

function getCurrentPeriod(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11
    const day = date.getDate(); // 1-31
    
    let periodStart, periodEnd;
    
    switch(smartPeriod) {
        case periodTypes.WEEKLY: {
            // Monday to Sunday
            const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday
            const monday = new Date(date);
            monday.setDate(day - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
            monday.setHours(0, 0, 0, 0);
            
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            sunday.setHours(23, 59, 59, 999);
            
            periodStart = monday;
            periodEnd = sunday;
            break;
        }
        
        case periodTypes.BIWEEKLY: {
            // Every 2 weeks (14 days)
            const dayOfWeek = date.getDay();
            const monday = new Date(date);
            monday.setDate(day - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
            monday.setHours(0, 0, 0, 0);
            
            // Determine if we're in the first or second week of the biweekly period
            const weekOfYear = Math.floor((date - new Date(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
            const isFirstWeek = weekOfYear % 2 === 0;
            
            if (!isFirstWeek) {
                monday.setDate(monday.getDate() - 7);
            }
            
            const endDate = new Date(monday);
            endDate.setDate(monday.getDate() + 13);
            endDate.setHours(23, 59, 59, 999);
            
            periodStart = monday;
            periodEnd = endDate;
            break;
        }
        
        case periodTypes.MONTHLY: {
            // Day 1 to last day of month
            periodStart = new Date(year, month, 1, 0, 0, 0, 0);
            periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
            break;
        }
        
        case periodTypes.TWO_TIMES_MONTH: {
            // Days 1-15 and 16-end
            if (day <= 15) {
                periodStart = new Date(year, month, 1, 0, 0, 0, 0);
                periodEnd = new Date(year, month, 15, 23, 59, 59, 999);
            } else {
                periodStart = new Date(year, month, 16, 0, 0, 0, 0);
                periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
            }
            break;
        }
        
        case periodTypes.THREE_TIMES_MONTH: {
            // Days 1-10, 11-20, 21-end
            if (day <= 10) {
                periodStart = new Date(year, month, 1, 0, 0, 0, 0);
                periodEnd = new Date(year, month, 10, 23, 59, 59, 999);
            } else if (day <= 20) {
                periodStart = new Date(year, month, 11, 0, 0, 0, 0);
                periodEnd = new Date(year, month, 20, 23, 59, 59, 999);
            } else {
                periodStart = new Date(year, month, 21, 0, 0, 0, 0);
                periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
            }
            break;
        }
        
        case periodTypes.FOUR_TIMES_MONTH: {
            // Days 1-7, 8-14, 15-21, 22-end
            if (day <= 7) {
                periodStart = new Date(year, month, 1, 0, 0, 0, 0);
                periodEnd = new Date(year, month, 7, 23, 59, 59, 999);
            } else if (day <= 14) {
                periodStart = new Date(year, month, 8, 0, 0, 0, 0);
                periodEnd = new Date(year, month, 14, 23, 59, 59, 999);
            } else if (day <= 21) {
                periodStart = new Date(year, month, 15, 0, 0, 0, 0);
                periodEnd = new Date(year, month, 21, 23, 59, 59, 999);
            } else {
                periodStart = new Date(year, month, 22, 0, 0, 0, 0);
                periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
            }
            break;
        }
        
        default:
            throw new Error(`Unknown period type: ${smartPeriod}`);
    }
    
    return {
        start: periodStart,
        end: periodEnd,
        startTimestamp: Math.floor(periodStart.getTime() / 1000),
        endTimestamp: Math.floor(periodEnd.getTime() / 1000)
    };
}

function hasPurchasedThisPeriod(state, currentPeriod) {
    if (!state || !state.lastPurchase) {
        return false;
    }
    
    const lastPurchaseDate = new Date(state.lastPurchase.timestamp);
    return lastPurchaseDate >= currentPeriod.start && lastPurchaseDate <= currentPeriod.end;
}

function isLastDayOfPeriod(currentPeriod) {
    const now = new Date();
    const endDate = new Date(currentPeriod.end);
    
    return now.getFullYear() === endDate.getFullYear() &&
           now.getMonth() === endDate.getMonth() &&
           now.getDate() === endDate.getDate();
}

function isFallbackTime(currentPeriod) {
    const now = new Date();
    const currentHour = now.getHours();
    
    return isLastDayOfPeriod(currentPeriod) && currentHour >= smartFallbackHour;
}

// ==================== PRICE FUNCTIONS ====================

async function getPriceAtTimestamp(timestamp) {
    try {
        // Get OHLC data around the timestamp
        // Kraken OHLC returns candles, we'll get the one closest to our timestamp
        const historicalData = await publicApi('OHLC', { 
            pair, 
            interval: 1440, // Daily candles
            since: timestamp - (86400 * 2) // 2 days before to ensure we have data
        });
        
        if (historicalData.error && historicalData.error.length > 0) {
            throw new Error(`Kraken API error: ${historicalData.error.join(', ')}`);
        }
        
        const ohlcData = historicalData.result[pair];
        
        // Find the candle closest to our timestamp
        let closestCandle = ohlcData[0];
        let minDiff = Math.abs(ohlcData[0][0] - timestamp);
        
        for (const candle of ohlcData) {
            const diff = Math.abs(candle[0] - timestamp);
            if (diff < minDiff) {
                minDiff = diff;
                closestCandle = candle;
            }
        }
        
        // Return opening price (index 1) of the closest candle
        return parseFloat(closestCandle[1]);
    } catch (e) {
        console.error('Error getting historical price:', e.message);
        throw e;
    }
}

async function getCurrentPrice() {
    try {
        const historicalData = await publicApi('OHLC', { pair, interval: 1 });
        
        if (historicalData.error && historicalData.error.length > 0) {
            throw new Error(`Kraken API error: ${historicalData.error.join(', ')}`);
        }
        
        const ohlcData = historicalData.result[pair];
        const lastOHLC = ohlcData[ohlcData.length - 1];
        return parseFloat(lastOHLC[4]); // Close price
    } catch (e) {
        console.error('Error getting current price:', e.message);
        throw e;
    }
}

// ==================== SIMPLE DCA MODE ====================

async function executeSimpleDCA() {
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

    await executePurchase(price, volume, 'SIMPLE_DCA');
}

// ==================== SMART DCA MODE ====================

async function executeSmartDCA() {
    console.log(`\n=== Smart DCA Execution: ${new Date().toISOString()} ===`);
    
    // Load state
    let state = loadState();
    if (!state) {
        console.log('Initializing new state file...');
        state = initializeState();
        saveState(state);
    }
    
    // Upgrade old state format
    if (!state.executedThresholds) state.executedThresholds = [];
    if (!state.purchaseHistory) state.purchaseHistory = [];
    
    // Check if configuration changed
    const currentConfig = smartThresholds || `${smartThreshold}:100`;
    if (state.config.period !== smartPeriod || 
        state.config.thresholds !== currentConfig ||
        state.config.fallbackHour !== smartFallbackHour) {
        console.log('Configuration changed, updating state...');
        state.config = {
            period: smartPeriod,
            thresholds: currentConfig,
            fallbackHour: smartFallbackHour
        };
        saveState(state);
    }
    
    // Get current period
    const currentPeriod = getCurrentPeriod();
    console.log(`Period: ${currentPeriod.start.toISOString()} to ${currentPeriod.end.toISOString()}`);
    
    // Reset executed thresholds if new period
    if (!hasPurchasedThisPeriod(state, currentPeriod)) {
        if (state.executedThresholds.length > 0) {
            console.log('New period detected, resetting executed thresholds...');
            state.executedThresholds = [];
            state.lastPurchase = null;
            saveState(state);
        }
    }
    
    // Parse thresholds configuration
    const thresholds = parseThresholds();
    console.log(`Thresholds configured: ${thresholds.map(t => `-${t.percent}%:${t.budget}%`).join(', ')}`);
    
    // Check if all thresholds executed
    if (state.executedThresholds.length >= thresholds.length) {
        console.log('All thresholds executed this period. Waiting for next period...');
        return;
    }
    
    // Check if there's a pending fallback purchase from previous failure
    if (state.pendingFallbackPurchase) {
        console.log('⚠️  Pending fallback purchase detected! Attempting immediate purchase...');
        try {
            const currentPrice = await getCurrentPrice();
            
            // Check Binance comparison
            const priceComparison = await comparePrices(currentPrice);
            if (priceComparison.shouldWait) {
                console.log(`⏸️  Kraken ${priceComparison.diff.toFixed(2)}% more expensive than Binance, skipping...`);
                return;
            }
            
            const remainingBudget = 100 - state.executedThresholds.reduce((sum, t) => sum + t.budgetUsed, 0);
            await executePurchaseWithTracking(state, currentPrice, remainingBudget, 'FALLBACK_RETRY', 0, currentPeriod, priceComparison);
            
            state.pendingFallbackPurchase = false;
            saveState(state);
            console.log('✅ Fallback purchase completed successfully!');
            return;
        } catch (e) {
            console.error('❌ Fallback purchase retry failed:', e.message);
            return;
        }
    }
    
    // Get prices
    let startPrice, currentPrice;
    try {
        console.log('Fetching prices from Kraken...');
        startPrice = await getPriceAtTimestamp(currentPeriod.startTimestamp);
        currentPrice = await getCurrentPrice();
        console.log(`Start price: ${startPrice} | Current price: ${currentPrice}`);
    } catch (e) {
        console.error('❌ Error fetching prices from Kraken:', e.message);
        return;
    }
    
    // Calculate price change percentage
    const priceChange = ((currentPrice - startPrice) / startPrice) * 100;
    console.log(`Price change: ${priceChange.toFixed(2)}%`);
    
    // Check Binance comparison
    const priceComparison = await comparePrices(currentPrice);
    if (priceComparison.shouldWait) {
        console.log(`⏸️  Kraken ${priceComparison.diff.toFixed(2)}% more expensive than Binance, skipping...`);
        return;
    }
    
    // Check each threshold
    let purchaseTriggered = false;
    for (const threshold of thresholds) {
        // Skip if already executed
        if (state.executedThresholds.some(t => t.thresholdPercent === threshold.percent)) {
            continue;
        }
        
        // Check if threshold met
        if (priceChange <= -threshold.percent) {
            console.log(`✅ Threshold -${threshold.percent}% met! (actual: ${priceChange.toFixed(2)}%)`);
            
            // Send near-threshold notification if we haven't notified for this one
            await sendTelegram(`🎯 <b>Threshold Triggered!</b>\n\nPair: ${pair}\nThreshold: -${threshold.percent}%\nActual change: ${priceChange.toFixed(2)}%\nCurrent price: ${currentPrice}€\n\n💰 Purchasing ${threshold.budget}% of budget...`);
            
            try {
                await executePurchaseWithTracking(state, currentPrice, threshold.budget, `THRESHOLD_${threshold.percent}`, threshold.percent, currentPeriod, priceComparison);
                purchaseTriggered = true;
                
                // Mark this threshold as executed
                state.executedThresholds.push({
                    thresholdPercent: threshold.percent,
                    budgetUsed: threshold.budget,
                    timestamp: new Date().toISOString(),
                    priceChange: priceChange
                });
                saveState(state);
                
                console.log(`✅ Purchase completed for threshold -${threshold.percent}%`);
            } catch (e) {
                console.error(`❌ Purchase failed for threshold -${threshold.percent}%:`, e.message);
            }
            
            // Only execute one threshold per run
            break;
        } else {
            // Check if near threshold (within 0.2%)
            const distanceToThreshold = Math.abs(priceChange + threshold.percent);
            if (distanceToThreshold <= 0.2 && !state[`notified_${threshold.percent}`]) {
                await sendTelegram(`🔔 <b>Price Alert!</b>\n\nPair: ${pair}\nCurrent change: ${priceChange.toFixed(2)}%\nThreshold: -${threshold.percent}%\nDistance: ${distanceToThreshold.toFixed(2)}%\n\n⏳ Almost there!`);
                state[`notified_${threshold.percent}`] = true;
                saveState(state);
            }
        }
    }
    
    // If no threshold triggered, check fallback
    if (!purchaseTriggered && isFallbackTime(currentPeriod)) {
        console.log('⏰ Fallback time reached on last day of period.');
        
        const remainingBudget = 100 - state.executedThresholds.reduce((sum, t) => sum + t.budgetUsed, 0);
        
        if (remainingBudget > 0) {
            await sendTelegram(`⏰ <b>Fallback Purchase</b>\n\nPair: ${pair}\nPeriod ending, forcing purchase\nCurrent price: ${currentPrice}€\nBudget: ${remainingBudget}%`);
            
            try {
                await executePurchaseWithTracking(state, currentPrice, remainingBudget, 'FALLBACK', 0, currentPeriod, priceComparison);
                console.log(`✅ Fallback purchase completed!`);
            } catch (e) {
                console.error('❌ Fallback purchase failed:', e.message);
                state.pendingFallbackPurchase = true;
                saveState(state);
            }
        } else {
            console.log('All budget already used, no fallback needed.');
        }
    } else if (!purchaseTriggered) {
        console.log('⏸️  No purchase conditions met. Waiting...');
    }
}

// ==================== PURCHASE EXECUTION ====================

async function executePurchaseWithTracking(state, price, budgetPercent, trigger, thresholdPercent, currentPeriod, priceComparison) {
    const totalBudget = quantity_second;
    const amountToSpend = (totalBudget * budgetPercent) / 100;
    const volume = amountToSpend / parseFloat(price);
    
    await executePurchase(price, volume, trigger);
    
    // Add to purchase history
    const purchase = {
        timestamp: new Date().toISOString(),
        price: parseFloat(price),
        volume: parseFloat(volume),
        spent: amountToSpend,
        budgetPercent: budgetPercent,
        trigger: trigger,
        thresholdPercent: thresholdPercent,
        priceChangeFromPeriodStart: ((price - await getPriceAtTimestamp(currentPeriod.startTimestamp)) / await getPriceAtTimestamp(currentPeriod.startTimestamp)) * 100,
        krakenVsBinanceDiff: priceComparison.diff || 0,
        binancePrice: priceComparison.binancePrice || null
    };
    
    state.purchaseHistory.push(purchase);
    state.lastPurchase = purchase;
    
    // Send success notification
    const message = `✅ <b>Purchase Executed!</b>\n\n` +
        `Pair: ${pair}\n` +
        `Trigger: ${trigger}\n` +
        `Price: ${price}€\n` +
        `Volume: ${volume.toFixed(8)}\n` +
        `Spent: ${amountToSpend.toFixed(2)}€ (${budgetPercent}%)\n` +
        `${priceComparison.binancePrice ? `Binance: ${priceComparison.binancePrice}€ (${priceComparison.diff.toFixed(2)}%)\n` : ''}` +
        `\n📊 Total purchases this period: ${state.executedThresholds.length + 1}`;
    
    await sendTelegram(message);
    
    saveState(state);
}

async function executePurchase(price, volume = null, trigger = 'MANUAL') {
    // If volume not provided, calculate it
    if (volume === null) {
        if (quantity_first && !isNaN(quantity_first)) {
            volume = quantity_first;
        } else {
            volume = parseFloat(quantity_second) / parseFloat(price);
        }
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
        volume: volume,
    };

    if (simulator) {
        console.log('Dry-run mode: Order would be placed with params:', orderParams);
        console.log(`Trigger: ${trigger}`);
    } else {
        const orderResponse = await privateApi('AddOrder', orderParams);
        console.log('Full response:', JSON.stringify(orderResponse, null, 2));
        if (orderResponse.error && orderResponse.error.length > 0) {
            throw new Error(`Kraken API error: ${orderResponse.error.join(', ')}`);
        }
        const orderInfo = JSON.stringify(orderResponse)
            .replace(/[{}]/g, '')
            .replace(/":/g, ':')
            .replace(/,"/g, ',')
            .replace(/"/g, '');
        console.log(`Order placed: ${orderInfo} | Trigger: ${trigger}`);
    }
}

// ==================== MAIN ====================

async function main() {
    try {
        if (mode === 'SMART') {
            await executeSmartDCA();
        } else {
            await executeSimpleDCA();
        }
    } catch (e) {
        console.error('Error:', e.message);
        console.error(e);
    }
}

main().catch(err => console.error('Fatal error:', err));