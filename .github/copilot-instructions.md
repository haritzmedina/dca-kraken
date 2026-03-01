# dca-kraken AI Coding Instructions

## Project Overview
**dca-kraken** is a Dollar-Cost Averaging (DCA) trading bot for Kraken cryptocurrency exchange. It supports two distinct operating modes that require different logic paths and state management strategies.

## Architecture & Core Concepts

### Two Operating Modes
- **SIMPLE**: Executes purchases based on calculated price metrics (CURRENT, LOWEST, VWAP_MEAN, CLOSE_AVERAGE) with optional discounts. Stateless, runs on schedule.
- **SMART**: Monitors price changes within configurable periods (WEEKLY, BIWEEKLY, MONTHLY, 2_TIMES_MONTH, 3_TIMES_MONTH, 4_TIMES_MONTH). Uses persistent state to:
  - Track executed thresholds (prevent duplicate purchases per period)
  - Reset state on period boundaries
  - Execute fallback purchases at period end if no threshold triggered
  - Handle retry logic for failed purchases

**Critical pattern**: When modifying SMART mode, respect the state file state machine - period resets must clear `executedThresholds` and `periodPeakPrice`.

### Configuration-Driven Design
All behavior controlled via `.env` files passed as argument: `node index.js config.env`
- **No hardcoded settings** - even defaults come from `process.env.VAR || fallback`
- Multiple `.env` files can coexist (e.g., `btc.env`, `eth-smart.env`)
- Configuration validation happens at runtime (check README.md tables for required vs optional vars)

## Key Technical Patterns

### Price Calculations (SIMPLE Mode)
```javascript
// Uses historical OHLC data from Kraken's 1440-minute (daily) candles
// Four strategies available:
- CURRENT: Last close price
- LOWEST: Minimum low price from lookback period (days)
- VWAP_MEAN: Volume-weighted average price
- CLOSE_AVERAGE: Simple average of close prices
// Can apply discount: price = price - (price * LESS_PERCENTAGE)
```
Use [Decimal.js](index.js#L7) for all price/volume math to avoid floating-point errors.

### Period Management (SMART Mode)
[getCurrentPeriod()](index.js#L288-L365) returns period boundaries based on `SMART_PERIOD`. **Critical**: 
- Each case handles start/end timestamps for period-specific logic
- Must align with fallback purchase timing (`SMART_FALLBACK_HOUR`)
- [hasPurchasedThisPeriod()](index.js#L374) checks if last purchase is within current period bounds

### State Persistence (SMART Mode)
[State file structure](index.js#L241-L263):
- `lastPurchase`: Latest purchase details (for period detection)
- `executedThresholds`: Array tracking which thresholds fired (prevents duplicates)
- `purchaseHistory`: Full audit log with prices, triggers, budget percentages
- `pendingFallbackPurchase`: Flag for failed fallback retry logic
- `config`: Snapshot of settings (detects config changes and upgrades state format)

**Save after every mutation**: [saveState())(index.js#L235) must be called after state changes to avoid data loss.

### Kraken API Integration

**Public API** ([publicApi()](index.js#L54-L60)):
- OHLC data: Requires `pair` format (e.g., `XXBTZEUR`, `DOTEUR`)
- Parameters: `interval` (1, 5, 15, 30, 60, 240, 1440, 10080, 21600 minutes), `since` (timestamp)

**Private API** ([privateApi()](index.js#L71-L89)):
- AddOrder endpoint for trades
- Uses [HMAC-SHA512 signature](index.js#L62-L70) with specific path+sha256(nonce+data) format
- Requires API-Key and API-Sign headers
- Response includes array in `.error` even for non-fatal warnings

**Pair formatting**: Some pairs use Kraken's prefixes (XBT for Bitcoin, XXB for some alt-coins). Binance comparison [converts](index.js#L124) `XXBTZEUR` → `BTCEUR`.

### Threshold Execution Logic (SMART Mode)
[parseThresholds()](index.js#L184-L197) handles two formats:
- Legacy: Single threshold `SMART_THRESHOLD_PERCENT` (e.g., `3` = -3% drop)
- Advanced: Multiple thresholds with budget splits `"1:25,3:25,5:25,10:25"` (drop 1% spend 25%, drop 3% spend 25%, etc.)

[Reference price selection](index.js#L728-L738):
- `INITIAL`: Threshold compares current price vs period start price
- `PEAK`: Threshold compares current price vs highest price in period (buy more on deeper drops)

Only one threshold executes per run to avoid overshooting budget.

### Purchase Execution
[executePurchase()](index.js#L827-L860):
- Places limit orders at specified price with calculated volume
- Respects pair's `pair_decimals` and `lot_decimals` precision requirements
- `SIMULATOR=true` logs order params without submitting
- Throws error if `orderResponse.error` array is non-empty

[executePurchaseWithTracking()](index.js#L812-L850) adds:
- Budget tracking (budgetPercent of total `QUANTITY_SECOND`)
- Trigger classification (SIMPLE_DCA, THRESHOLD_3, FALLBACK, etc.)
- Telegram notification with price/volume/spent details
- History recording with Kraken vs Binance diffs

## Developer Workflows

### Testing & Debugging
1. **Dry-run mode**: Set `SIMULATOR=true` in .env - logs order params without executing
2. **State inspection**: Read `.env`'s `SMART_STATE_FILE` (default `./state.json`) to debug period/threshold state
3. **Configuration validation**: Check README.md tables; missing required vars like KEY/SECRET cause runtime errors

### Adding Features
1. **New SMART period**: Add case to [getCurrentPeriod()](index.js#L359-L365); update [periodTypes](index.js#L21-L28)
2. **New price metric**: Add type to [types](index.js#L14-L18), calculate in executeSimpleDCA()
3. **New notifications**: All notifications go through [sendTelegram()](index.js#L103-L121); add condition in appropriate handler
4. **API rate limiting**: No current backoff - can be added to publicApi/privateApi if Kraken enforces rate limits

### Cron Scheduling
```bash
# SIMPLE: Daily purchases at 1 AM
0 1 * * * node dca-kraken/index.js dca-kraken/btc.env >> /var/log/dca-kraken-btc.txt 2>&1

# SMART: Check every 5 minutes (covers thresholds + fallback)
*/5 * * * * node dca-kraken/index.js dca-kraken/btc-smart.env >> /var/log/dca-kraken-smart.txt 2>&1
```

## Integration Points & External Dependencies

### Kraken Exchange API
- Public endpoints: OHLC historical data, asset pair info
- Private endpoints: AddOrder (limit buy orders only, no sell/cancel logic)
- Error handling: Check `.error` array in responses (non-empty = error)

### Telegram Notifications (Optional)
[sendTelegram()](index.js#L103-L121) requires `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- HTML formatting supported (`<b>`, `<i>`)
- Used for: threshold alerts, purchase confirmation, insufficient funds warnings, price alerts

### Binance Price Comparison (Optional)
[comparePrices()](index.js#L131-L156) compares Kraken price vs Binance spot price
- Enabled via `BINANCE_COMPARE=true`
- Skips purchase if Kraken premium > `BINANCE_MAX_DIFF_PERCENT` (default 0.5%)
- Gracefully degrades if Binance API unavailable

## Common Pitfalls & Edge Cases

1. **Floating-point precision**: Always use `Decimal.js` for calculations. Built-in Math loses precision on crypto amounts.
2. **Period boundary bugs**: Test period transitions (month-end, week boundaries). State reset logic relies on accurate period calculation.
3. **State file corruption**: If JSON parse fails during config change, state upgrade can be lost. Add backups before major version changes.
4. **API pair format inconsistency**: Kraken uses prefixes (XXBTZEUR, DOTEUR). Binance uses standard format. Conversion happens [here](index.js#L124).
5. **Threshold math order**: `(current - reference) / reference * 100` gives percent change. Negative = dropped (triggers threshold like -3%).
6. **Fallback timing**: Must check `isLastDayOfPeriod()` AND `hour >= SMART_FALLBACK_HOUR`. Both conditions required.

## Dependencies
- **dotenv** (16.0.3): Loads .env configuration
- **decimal.js** (10.4.3): Precise decimal arithmetic for financial calculations
- **crypto** (Node.js built-in): HMAC-SHA512 for Kraken API signatures
- **fs** (Node.js built-in): State file persistence
