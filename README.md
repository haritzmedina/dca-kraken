> **Warning**
> Please, if you don't trust don't put any money in any exchange and keep save your crypto preferably in hot or cold wallets!

# dca-kraken
It is a small script to do dollar cost averaging of a pair in Kraken exchange using cron.

1. Get your API key and API secret from Kraken
2. Create a .env file to configure your DCA. YOu can use as example: example.env
3. Create a cron with the following to buy everyday 

````
# m     h       dom             mon     dow     command
0       1       *               *       *       node dca-kraken/index.js dca-kraken/btc.env >> /var/log/dca-kraken-example-log.txt 2>/var/log/dca-kraken-example-error.txt
````

## Things that you can configure in .env

- `KEY` (required): This is the Kraken API key that you need to provide in order to authenticate your API requests.

- `SECRET` (required): This is the secret key that corresponds to your Kraken API key.

- `PAIR` (required): This is the trading pair you want to trade on Kraken, e.g., "DOTEUR" for trading between the DOT token and the euro.

- `TYPE` (optional, default = CURRENT): This parameter specifies the type of periodic purchase you want to make. Possible values LOWEST (Lowest price in defined DAYS), CURRENT (current market price), VWAP_MEAN (Volume-based mean) and CLOSE_AVERAGE (average price based on candles close values) in the defined DAYS.

- `QUANTITY_FIRST` (choose first or second): This parameter specifies the amount of the first coin in the trading pair that you want to purchase in the first purchase. For example, if you are trading the BTC/USD pair, this parameter would specify the amount of BTC you want to purchase in the first purchase. Leave it blank if QUANTITY_SECOND is defined

- `QUANTITY_SECOND` (choose first or second): This parameter specifies the amount of the second coin in the trading pair that you want to purchase in the subsequent purchases. For example, if you are trading the BTC/USD pair, this parameter would specify the amount of USD you want to spend on BTC in the subsequent purchases. Leave it blank if QUANTITY_FIRST is defined.

- `DAYS` (optional, default = 1): This parameter specifies the number of days for which you want to make periodic purchases.

- `LESS_PERCENTAGE` (optional, default = 0): This parameter specifies the percentage below the average price at which you want to place a limit buy order. For exampl, "0.01" means that you want to place a limit buy order at 1% below the average price.

These parameters are used to configure the Kraken periodic purchases application and tailor it to your specific needs.