# dca-kraken
Dollar-Cost Averaging (DCA) script for Kraken cryptocurrency exchange with two operating modes: **Simple** and **Smart**.

> **Warning**
> Please, if you don't trust don't put any money in any exchange and keep save your crypto preferably in hot or cold wallets!

## 🚀 Quick Start

1. Get your API key and API secret from Kraken
2. Create a .env file to configure your DCA (use example.env as template)
3. Choose your mode: **SIMPLE** or **SMART**
4. Set up cron to run the script

## 📋 Operating Modes

### **SIMPLE Mode** (Traditional DCA)
Executes a purchase immediately every time the script runs. Best used with cron for scheduled purchases.

**Cron example** - Buy every day at 1 AM:
```bash
0  1  *  *  *  node dca-kraken/index.js dca-kraken/btc.env >> /var/log/dca-kraken-btc.txt 2>&1
```

### **SMART Mode** (Intelligent DCA)
Monitors price changes and purchases when:
- Price drops by a specified threshold percentage, OR
- Period ends without a purchase (fallback mechanism)

**Cron example** - Check every 30 minutes:
```bash
*/30  *  *  *  *  node dca-kraken/index.js dca-kraken/btc-smart.env >> /var/log/dca-kraken-smart.txt 2>&1
```

**Key features:**
- ✅ Buys when price drops X% from period start
- ✅ Ensures one purchase per period (fallback)
- ✅ Prevents multiple purchases in same period
- ✅ Automatic retry if Kraken fails during fallback
- ✅ Period-based scheduling (weekly, monthly, custom)

---

## ⚙️ Configuration (.env file)

### **Common Settings (Both Modes)**

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `KEY` | ✅ | Kraken API key | `your_api_key` |
| `SECRET` | ✅ | Kraken API secret | `your_secret` |
| `PAIR` | ✅ | Trading pair | `BTCEUR`, `DOTEUR` |
| `QUANTITY_FIRST` | ⚠️ | Amount of first coin to purchase | `0.001` (for BTC) |
| `QUANTITY_SECOND` | ⚠️ | Amount of second coin to spend | `50` (50 EUR) |
| `SIMULATOR` | ❌ | Dry-run mode (doesn't place orders) | `true` or `false` |

> **Note:** Choose **either** `QUANTITY_FIRST` or `QUANTITY_SECOND`, not both.

---

### **SIMPLE Mode Settings**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MODE` | ❌ | `SIMPLE` | Set to `SIMPLE` |
| `TYPE` | ❌ | `CURRENT` | Price calculation method |
| `DAYS` | ❌ | `1` | Historical days for price calculation |
| `LESS_PERCENTAGE` | ❌ | `0` | % below calculated price for limit order |

**TYPE Options:**
- `CURRENT`: Current market price
- `LOWEST`: Lowest price in last N days
- `VWAP_MEAN`: Volume-weighted average price
- `CLOSE_AVERAGE`: Average closing price over N days

**Example SIMPLE .env:**
```env
KEY=your_key
SECRET=your_secret
PAIR=BTCEUR
MODE=SIMPLE
TYPE=CLOSE_AVERAGE
QUANTITY_SECOND=100
DAYS=7
LESS_PERCENTAGE=0.01
SIMULATOR=false
```

---

### **SMART Mode Settings**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MODE` | ✅ | - | Set to `SMART` |
| `SMART_PERIOD` | ❌ | `4_TIMES_MONTH` | Purchase frequency |
| `SMART_THRESHOLDS` | ❌ | - | Multiple thresholds (advanced) |
| `SMART_THRESHOLD_PERCENT` | ❌ | `3` | Single threshold (legacy) |
| `SMART_THRESHOLD_REFERENCE` | ❌ | `INITIAL` | Reference price: `INITIAL` or `PEAK` |
| `SMART_FALLBACK_HOUR` | ❌ | `22` | Hour (0-23) for fallback purchase |
| `SMART_STATE_FILE` | ❌ | `./state.json` | File to store purchase history |
| `BINANCE_COMPARE` | ❌ | `false` | Compare prices with Binance |
| `BINANCE_MAX_DIFF_PERCENT` | ❌ | `0.5` | Max acceptable price difference (%) |
| `TELEGRAM_ENABLED` | ❌ | `false` | Enable Telegram notifications |
| `TELEGRAM_BOT_TOKEN` | ❌ | - | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | ❌ | - | Your chat ID from @userinfobot |

**SMART_PERIOD Options:**
- `WEEKLY`: Once per week (Monday-Sunday)
- `BIWEEKLY`: Every 2 weeks (14 days)
- `MONTHLY`: Once per month (1st to last day)
- `2_TIMES_MONTH`: Days 1-15 and 16-end
- `3_TIMES_MONTH`: Days 1-10, 11-20, 21-end
- `4_TIMES_MONTH`: Days 1-7, 8-14, 15-21, 22-end

**SMART_THRESHOLD_REFERENCE Options:**

Choose how thresholds are calculated:

- **`INITIAL`** (default): Thresholds calculated from period **start price**
  - Simple and predictable behavior
  - Example: Period starts at 100€, -3% threshold = 97€
  - Best for: Stable markets, predictable entries

- **`PEAK`** (recommended for volatile assets): Thresholds calculated from period's **highest price**
  - Captures real drops from recent peaks
  - Automatically tracks the maximum price during the period
  - Example: Period starts at 100€, rises to 110€ (peak), -3% threshold = 106.7€
  - Better captures corrections after rallies within the period
  - Best for: Bitcoin and volatile cryptocurrencies

**Comparison Example:**
```
Day 1: Price 45,000€ (period starts)
Day 3: Price rises to 48,000€ (new peak)
Day 4: Price drops to 46,500€

INITIAL strategy:
  - Reference: 45,000€
  - Change: +3.3% (no purchase, still above start)
  
PEAK strategy:
  - Reference: 48,000€ (tracked peak)
  - Change: -3.1% (purchase triggered at -3% threshold!)
```

**SMART_THRESHOLDS Format** (Multiple Thresholds - Advanced DCA):
```
SMART_THRESHOLDS=1:25,3:25,5:25,10:25
```
Format: `drop%:budget%,drop%:budget%,...`
- `-1%` drop → Buy 25% of budget
- `-3%` drop → Buy another 25%
- `-5%` drop → Buy another 25%
- `-10%` drop → Buy last 25%

Benefits:
- ✅ Captures multiple price drops
- ✅ Distributes risk across different entry points
- ✅ Buys more aggressively as price drops further
- ✅ Never misses an opportunity

**Example SMART .env (Simple):**
```env
KEY=your_key
SECRET=your_secret
PAIR=BTCEUR
MODE=SMART
QUANTITY_SECOND=100
SMART_PERIOD=4_TIMES_MONTH
SMART_THRESHOLD_PERCENT=3
SMART_FALLBACK_HOUR=22
SMART_STATE_FILE=./state-btc.json
SIMULATOR=false
```

**Example SMART .env (Advanced with Multiple Thresholds):**
```env
KEY=your_key
SECRET=your_secret
PAIR=BTCEUR
MODE=SMART
QUANTITY_SECOND=100
SMART_PERIOD=4_TIMES_MONTH
SMART_THRESHOLDS=1:25,3:25,5:25,10:25
SMART_FALLBACK_HOUR=22
SMART_STATE_FILE=./state-btc.json
BINANCE_COMPARE=true
BINANCE_MAX_DIFF_PERCENT=0.5
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=987654321
SIMULATOR=false
```

---

## 🧠 How SMART Mode Works

### **Decision Flow (Single Threshold)**

1. **Script runs** (e.g., every 5-10 minutes via cron)
2. **Check state file**: Already purchased this period?
   - ✅ Yes → Exit (wait for next period)
   - ❌ No → Continue
3. **Check pending fallback**: Is there a failed fallback purchase?
   - ✅ Yes → Retry purchase immediately
   - ❌ No → Continue
4. **Get prices from Kraken**:
   - Price at period start
   - Current price
5. **Compare with Binance** (if enabled):
   - If Kraken > Binance + X% → Skip and wait
6. **Calculate change**: `(current - start) / start * 100`
7. **Decision**:
   - If change ≤ `-SMART_THRESHOLD_PERCENT` → **BUY** (threshold met)
   - Else if last day + hour ≥ `SMART_FALLBACK_HOUR` → **BUY** (fallback)
   - Else → Wait for next check
8. **After purchase**: Update state file with timestamp and trigger type

### **Decision Flow (Multiple Thresholds)**

1. **Script runs frequently** (every 5-10 minutes recommended)
2. **Check state file**: Which thresholds already executed?
3. **Get prices** and **compare with Binance** (if enabled)
4. **Calculate change** from period start
5. **For each threshold** (in order):
   - If threshold met AND not yet executed → **BUY** that percentage
   - Mark threshold as executed
   - Send Telegram notification
   - Stop (only one threshold per execution)
6. **Near-threshold alerts**: Notify when within 0.2% of threshold
7. **Fallback**: If period ending and budget remaining → Buy rest
8. **Track everything** in purchase history

### **Example Scenario (Single Threshold)**

**Configuration:**
- Period: `4_TIMES_MONTH` (4 purchases/month)
- Threshold: `3%` drop
- Fallback hour: `22` (10 PM)
- Cron: Every 30 minutes

**Timeline (Days 1-7 of month):**

```
Day 1, 00:00 → Period starts, BTC = 45000€
Day 1, 10:30 → BTC = 44500€ (-1.1%) → Wait (threshold not met)
Day 2, 15:00 → BTC = 43500€ (-3.3%) → ✅ BUY (threshold met!)
Day 3-7      → Already bought this period → Skip all checks
Day 8, 00:00 → New period starts...
```

### **Example Scenario (Multiple Thresholds)**

**Configuration:**
- Budget: 100€ per period
- Period: `4_TIMES_MONTH` (Days 1-7)
- Thresholds: `1:25,3:25,5:25,10:25`
- Binance comparison: Enabled (0.5% max diff)
- Telegram: Enabled
- Cron: Every 5 minutes

**Timeline:**

```
Day 1, 00:00 → Period starts, BTC = 50000€

Day 1, 10:15 → BTC = 49600€ (-0.8%)
            → 📱 Telegram: "Price alert! -0.8% (threshold: -1%)"

Day 1, 14:30 → BTC = 49500€ (-1.0%)
            → Threshold 1 met!
            → Check Binance: 49480€ (Kraken +0.04%, OK)
            → ✅ BUY 25€ (0.000505 BTC)
            → 📱 Telegram: "Purchase executed! -1% threshold, 25€"
            → State: executedThresholds = [1%]

Day 2, 09:00 → BTC = 48600€ (-2.8%)
            → Threshold 1 already executed, skip
            → 📱 Telegram: "Price alert! -2.8% (threshold: -3%)"

Day 2, 11:20 → BTC = 48400€ (-3.2%)
            → Threshold 2 met!
            → Check Binance: 48500€ (Kraken -0.2%, OK)
            → ✅ BUY 25€ (0.000516 BTC)
            → 📱 Telegram: "Purchase executed! -3% threshold, 25€"
            → State: executedThresholds = [1%, 3%]

Day 3, 08:00 → BTC = 47500€ (-5.0%)
            → Threshold 3 met!
            → ✅ BUY 25€ (0.000526 BTC)
            → State: executedThresholds = [1%, 3%, 5%]

Day 4-6      → Price hovers around -5%, no new thresholds

Day 7, 22:00 → Last day, fallback hour
            → Only 3 thresholds executed (75€ spent)
            → Remaining budget: 25€
            → ✅ BUY 25€ (fallback)
            → 📱 Telegram: "Fallback purchase, 25€"

Day 8, 00:00 → New period, reset executedThresholds
```

**Result:** 4 purchases totaling 100€, better average price than single purchase!

---

## 📊 State File (SMART Mode)

The state file tracks purchase history and executed thresholds. **Do not edit manually.**

**Example `state.json` (Multiple Thresholds):**
```json
{
  "version": "2.0",
  "pair": "BTCEUR",
  "lastPurchase": {
    "timestamp": "2026-01-28T15:30:00.000Z",
    "price": 48400.00,
    "volume": 0.000516,
    "spent": 25.00,
    "budgetPercent": 25,
    "trigger": "THRESHOLD_3",
    "thresholdPercent": 3,
    "priceChangeFromPeriodStart": -3.2,
    "krakenVsBinanceDiff": -0.2,
    "binancePrice": 48500.00
  },
  "executedThresholds": [
    {
      "thresholdPercent": 1,
      "budgetUsed": 25,
      "timestamp": "2026-01-27T14:30:00Z",
      "priceChange": -1.0
    },
    {
      "thresholdPercent": 3,
      "budgetUsed": 25,
      "timestamp": "2026-01-28T11:20:00Z",
      "priceChange": -3.2
    },
    {
      "thresholdPercent": 5,
      "budgetUsed": 25,
      "timestamp": "2026-01-29T08:00:00Z",
      "priceChange": -5.0
    }
  ],
  "purchaseHistory": [
    {
      "timestamp": "2026-01-27T14:30:00Z",
      "price": 49500.00,
      "volume": 0.000505,
      "spent": 25.00,
      "budgetPercent": 25,
      "trigger": "THRESHOLD_1",
      "thresholdPercent": 1,
      "priceChangeFromPeriodStart": -1.0,
      "krakenVsBinanceDiff": 0.04,
      "binancePrice": 49480.00
    }
  ],
  "pendingFallbackPurchase": false,
  "config": {
    "period": "4_TIMES_MONTH",
    "thresholds": "1:25,3:25,5:25,10:25",
    "fallbackHour": 22
  }
}
```

**Trigger types:**
- `THRESHOLD_1`, `THRESHOLD_3`, etc.: Price dropped to that threshold
- `FALLBACK`: Period ended, forced purchase
- `FALLBACK_RETRY`: Retry after failed fallback

**Purchase History:** Complete log of all purchases with performance metrics

---

## 📱 Telegram Notifications

Enable real-time alerts about your DCA activity:

### **Setup**

1. **Create bot**: Talk to [@BotFather](https://t.me/BotFather) on Telegram
   - Send `/newbot`
   - Choose name and username
   - Copy the token (looks like `123456789:ABCdefGHIjklMNOpqrs`)

2. **Get your chat ID**: Talk to [@userinfobot](https://t.me/userinfobot)
   - Send any message
   - Copy your ID (looks like `123456789`)

3. **Configure**:
```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrs
TELEGRAM_CHAT_ID=123456789
```

### **Notification Types**

🔔 **Price Alert** (near threshold):
```
🔔 Price Alert!

Pair: BTCEUR
Current change: -0.8%
Threshold: -1%
Distance: 0.2%

⏳ Almost there!
```

🎯 **Threshold Triggered**:
```
🎯 Threshold Triggered!

Pair: BTCEUR
Threshold: -3%
Actual change: -3.2%
Current price: 48400€

💰 Purchasing 25% of budget...
```

✅ **Purchase Executed**:
```
✅ Purchase Executed!

Pair: BTCEUR
Trigger: THRESHOLD_3
Price: 48400€
Volume: 0.000516
Spent: 25.00€ (25%)
Binance: 48500€ (-0.2%)

📊 Total purchases this period: 2
```

⚠️ **Kraken Premium Alert**:
```
⚠️ Kraken Premium Alert

Kraken: 49500€
Binance: 49200€
Difference: +0.61%

⏸️ Waiting for better price...
```

---

## 🔍 Binance Price Comparison

Avoid overpaying by comparing Kraken prices with Binance before each purchase.

### **How it works**

1. Script fetches price from both exchanges
2. Calculates percentage difference
3. If Kraken is more than X% expensive → Skip purchase
4. Sends Telegram notification about the delay

### **Configuration**

```env
BINANCE_COMPARE=true
BINANCE_MAX_DIFF_PERCENT=0.5
```

**Recommended values:**
- `0.3%` - Very conservative (rarely buys if Kraken is premium)
- `0.5%` - Balanced (recommended for most users)
- `1.0%` - Aggressive (only skips if very expensive)

**Note:** Uses public APIs, no API keys needed. Automatically converts pair formats (XXBTZEUR → BTCEUR).

---

## 🛡️ Safety Features

1. **Period protection**: Tracks executed thresholds per period
2. **Fallback retry**: Auto-retry if Kraken fails during fallback
3. **Simulator mode**: Test without real orders (`SIMULATOR=true`)
4. **State validation**: Detects config changes and adapts
5. **Error handling**: Graceful failures with detailed logging
6. **Purchase history**: Complete audit trail of all transactions
7. **Price comparison**: Avoid overpaying vs other exchanges
8. **Real-time alerts**: Know immediately what's happening

---

## 📝 Examples

### **Conservative Monthly DCA**
```env
MODE=SMART
SMART_PERIOD=MONTHLY
SMART_THRESHOLD_PERCENT=5
QUANTITY_SECOND=500
```
→ Buys once/month when price drops 5% OR at month end

### **Aggressive Weekly DCA with Multiple Thresholds**
```env
MODE=SMART
SMART_PERIOD=WEEKLY
SMART_THRESHOLDS=0.5:30,1.5:30,3:40
QUANTITY_SECOND=100
BINANCE_COMPARE=true
TELEGRAM_ENABLED=true
```
→ Captures small dips aggressively, multiple entries

### **Balanced 4x/Month DCA (Recommended)**
```env
MODE=SMART
SMART_PERIOD=4_TIMES_MONTH
SMART_THRESHOLDS=1:25,3:25,5:25,10:25
QUANTITY_SECOND=100
BINANCE_COMPARE=true
BINANCE_MAX_DIFF_PERCENT=0.5
TELEGRAM_ENABLED=true
```
→ 4 purchases/month, distributed across price levels, smart protection

---

## 🐛 Troubleshooting

**Q: Script runs but doesn't buy (SMART mode)**
- Check if thresholds already executed this period (check state file)
- Verify threshold: Price may not have dropped enough
- Check if Binance comparison is blocking (Kraken too expensive)
- Check logs for errors

**Q: Multiple purchases in same period (legacy mode)**
- With multiple thresholds, this is normal behavior
- Each threshold triggers one purchase
- Ensure state file path is correct and writable

**Q: Fallback purchase not triggering**
- Verify `SMART_FALLBACK_HOUR` is correct
- Ensure script runs after that hour on the last day
- Check cron frequency (needs to run at least once during fallback hour)

**Q: State file not found error**
- Normal on first run, will be created automatically
- Check write permissions in the directory

**Q: Telegram notifications not working**
- Verify bot token and chat ID are correct
- Check `TELEGRAM_ENABLED=true`
- Test bot by sending a message to it first
- Check firewall/network for api.telegram.org access

**Q: Binance price comparison fails**
- Script will proceed with Kraken if Binance unavailable
- Check pair format (converts XXBTZEUR → BTCEUR automatically)
- Verify pair exists on Binance

**Q: How to reset thresholds mid-period?**
- Delete the state file to start fresh
- Or edit `executedThresholds` array in state file (advanced)

---

## 📜 License

ISC
