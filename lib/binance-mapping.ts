/**
 * Converts a CoinGecko coin symbol to a Binance trading pair symbol.
 *
 * CoinGecko uses lowercase symbols: 'btc', 'eth', 'sol'
 * Binance uses lowercase pairs:    'btcusdt', 'ethusdt', 'solusdt'
 *
 * Most coins map directly by appending 'usdt'. Override map handles edge cases.
 */

const SYMBOL_OVERRIDES: Record<string, string> = {
  // Add overrides for symbols that don't follow the simple <symbol>usdt pattern
  // e.g., 'iota': 'iotausdt',
};

export function toBinanceSymbol(geckoSymbol: string): string {
  const lower = geckoSymbol.toLowerCase();
  return SYMBOL_OVERRIDES[lower] ?? `${lower}usdt`;
}
