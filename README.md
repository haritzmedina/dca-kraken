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
| `SMART_THRESHOLD_PERCENT` | ❌ | `3` | % drop required to trigger purchase |
| `SMART_FALLBACK_HOUR` | ❌ | `22` | Hour (0-23) for fallback purchase |
| `SMART_STATE_FILE` | ❌ | `./state.json` | File to store purchase history |

**SMART_PERIOD Options:**
- `WEEKLY`: Once per week (Monday-Sunday)
- `BIWEEKLY`: Every 2 weeks (14 days)
- `MONTHLY`: Once per month (1st to last day)
- `2_TIMES_MONTH`: Days 1-15 and 16-end
- `3_TIMES_MONTH`: Days 1-10, 11-20, 21-end
- `4_TIMES_MONTH`: Days 1-7, 8-14, 15-21, 22-end

**Example SMART .env:**
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

---

## 🧠 How SMART Mode Works

### **Decision Flow**

1. **Script runs** (e.g., every 30 minutes via cron)
2. **Check state file**: Already purchased this period?
   - ✅ Yes → Exit (wait for next period)
   - ❌ No → Continue
3. **Check pending fallback**: Is there a failed fallback purchase?
   - ✅ Yes → Retry purchase immediately
   - ❌ No → Continue
4. **Get prices from Kraken**:
   - Price at period start
   - Current price
5. **Calculate change**: `(current - start) / start * 100`
6. **Decision**:
   - If change ≤ `-SMART_THRESHOLD_PERCENT` → **BUY** (threshold met)
   - Else if last day + hour ≥ `SMART_FALLBACK_HOUR` → **BUY** (fallback)
   - Else → Wait for next check
7. **After purchase**: Update state file with timestamp and trigger type

### **Example Scenario**

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

**Timeline with fallback:**

```
Day 1-6      → Price never drops 3% → No purchase
Day 7, 22:00 → Last day, fallback hour → ✅ BUY (fallback)
```

**Timeline with Kraken failure:**

```
Day 7, 22:00 → Fallback triggered, Kraken API fails
             → Set pendingFallbackPurchase flag
Day 7, 22:30 → Script runs again, detects flag → ✅ RETRY BUY
```

---

## 📊 State File (SMART Mode)

The state file tracks purchase history. **Do not edit manually.**

**Example `state.json`:**
```json
{
  "version": "1.0",
  "pair": "BTCEUR",
  "lastPurchase": {
    "timestamp": "2026-01-28T15:30:00.000Z",
    "price": 43500.50,
    "trigger": "THRESHOLD"
  },
  "pendingFallbackPurchase": false,
  "config": {
    "period": "4_TIMES_MONTH",
    "threshold": 3,
    "fallbackHour": 22
  }
}
```

**Trigger types:**
- `THRESHOLD`: Price dropped enough
- `FALLBACK`: Period ended, forced purchase
- `FALLBACK_RETRY`: Retry after failed fallback

---

## 🛡️ Safety Features

1. **Period protection**: Only 1 purchase per period
2. **Fallback retry**: Auto-retry if Kraken fails during fallback
3. **Simulator mode**: Test without real orders (`SIMULATOR=true`)
4. **State validation**: Detects config changes and adapts
5. **Error handling**: Graceful failures with detailed logging

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

### **Aggressive Weekly DCA**
```env
MODE=SMART
SMART_PERIOD=WEEKLY
SMART_THRESHOLD_PERCENT=2
QUANTITY_SECOND=100
```
→ Buys weekly when price drops 2% OR at week end

### **Balanced 4x/Month DCA**
```env
MODE=SMART
SMART_PERIOD=4_TIMES_MONTH
SMART_THRESHOLD_PERCENT=3
QUANTITY_SECOND=250
```
→ Buys 4 times/month (250€ each) when price drops 3% OR at period end

---

## 🐛 Troubleshooting

**Q: Script runs but doesn't buy (SMART mode)**
- Check if you already bought this period (check state file)
- Verify threshold: Price may not have dropped enough
- Check logs for errors

**Q: Multiple purchases in same period**
- Ensure state file path is correct and writable
- Check cron isn't running multiple instances simultaneously

**Q: Fallback purchase not triggering**
- Verify `SMART_FALLBACK_HOUR` is correct
- Ensure script runs after that hour on the last day
- Check cron frequency (needs to run at least once during fallback hour)

**Q: State file not found error**
- Normal on first run, will be created automatically
- Check write permissions in the directory

---

## 📜 License

ISC
