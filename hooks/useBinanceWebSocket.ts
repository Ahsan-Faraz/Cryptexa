'use client';

import { useEffect, useRef, useState } from 'react';
import { toBinanceSymbol } from '@/lib/binance-mapping';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

export const useBinanceWebSocket = ({
  symbol,
  liveInterval = '1m',
}: UseBinanceWebSocketProps): UseBinanceWebSocketReturn => {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const msgIdRef = useRef(0);

  const [price, setPrice] = useState<ExtendedPriceData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ohlcv, setOhlcv] = useState<OHLCData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const binanceSymbol = toBinanceSymbol(symbol);

  // Establish WebSocket connection once
  useEffect(() => {
    const ws = new WebSocket(BINANCE_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);

    ws.onmessage = (event: MessageEvent) => {
      const msg: BinanceMessage = JSON.parse(event.data);

      // Skip subscription confirmation responses
      if ('result' in msg) return;

      if (msg.e === '24hrTicker') {
        setPrice({
          usd: parseFloat(msg.c),
          coin: msg.s,
          price: parseFloat(msg.c),
          change24h: parseFloat(msg.P),
          volume24h: parseFloat(msg.q),
          timestamp: msg.C,
        });
      }

      if (msg.e === 'trade') {
        const tradePrice = parseFloat(msg.p);
        const tradeQty = parseFloat(msg.q);

        const newTrade: Trade = {
          price: tradePrice,
          amount: tradeQty,
          value: tradePrice * tradeQty,
          timestamp: msg.T,
          type: msg.m ? 's' : 'b', // m=true → seller is taker → Sell; m=false → buyer is taker → Buy
        };

        setTrades((prev) => [newTrade, ...prev].slice(0, 7));
      }

      if (msg.e === 'kline') {
        const k = msg.k;
        const candle: OHLCData = [
          Math.floor(k.t / 1000), // Convert ms → seconds for chart compatibility
          parseFloat(k.o),
          parseFloat(k.h),
          parseFloat(k.l),
          parseFloat(k.c),
        ];
        setOhlcv(candle);
      }
    };

    return () => ws.close();
  }, []);

  // Manage stream subscriptions when symbol, interval, or connection changes
  useEffect(() => {
    if (!isConnected || !wsRef.current) return;
    const ws = wsRef.current;

    const send = (payload: Record<string, unknown>) => ws.send(JSON.stringify(payload));

    // Unsubscribe from all previous streams
    if (subscribedRef.current.size > 0) {
      send({
        method: 'UNSUBSCRIBE',
        params: Array.from(subscribedRef.current),
        id: ++msgIdRef.current,
      });
      subscribedRef.current.clear();
    }

    // Reset state for new subscriptions
    setPrice(null);
    setTrades([]);
    setOhlcv(null);

    // Subscribe to ticker, trade, and kline streams
    const streams = [
      `${binanceSymbol}@ticker`,
      `${binanceSymbol}@trade`,
      `${binanceSymbol}@kline_${liveInterval}`,
    ];

    send({
      method: 'SUBSCRIBE',
      params: streams,
      id: ++msgIdRef.current,
    });

    streams.forEach((s) => subscribedRef.current.add(s));
  }, [binanceSymbol, isConnected, liveInterval]);

  return {
    price,
    trades,
    ohlcv,
    isConnected,
  };
};
