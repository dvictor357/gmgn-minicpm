// Read-only GMGN tool registry.
//
// Each tool maps to a NON-fund-moving gmgn-cli subcommand. Fund-moving
// subcommands (swap / multi-swap / order / cooking) are intentionally absent
// here AND hard-blocked in bridge.ts. This is v1: research only.
//
// Param names use snake_case; the bridge converts them to `--kebab-case` flags.

export type JsonSchema = {
  type: string;
  description?: string;
  enum?: string[];
  [k: string]: unknown;
};

export interface ToolDef {
  name: string;
  description: string;
  /** Base gmgn-cli subcommand, e.g. ["token", "info"]. */
  command: string[];
  parameters: {
    type: "object";
    properties: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties: false;
  };
}

const chain: JsonSchema = {
  type: "string",
  enum: ["sol", "bsc", "base", "eth", "robinhood"],
  description: "Blockchain: sol=Solana, bsc=BNB Chain, base=Base, eth=Ethereum, robinhood=Robinhood chain.",
};

const address: JsonSchema = {
  type: "string",
  description: "On-chain token contract address (base58 for SOL, 0x-hex for EVM). Never invent one.",
};

const wallet: JsonSchema = {
  type: "string",
  description: "On-chain wallet address to inspect. Never invent one.",
};

const limit: JsonSchema = { type: "integer", description: "Max number of rows to return." };

export const TOOLS: ToolDef[] = [
  // ---- token ----
  {
    name: "gmgn_token_info",
    description: "Basic token info + realtime price, liquidity, total supply, holder count, social links. Use for 'what is this token / its price'. Market cap = price.price * circulating_supply.",
    command: ["token", "info"],
    parameters: { type: "object", properties: { chain, address }, required: ["chain", "address"], additionalProperties: false },
  },
  {
    name: "gmgn_token_security",
    description: "Security audit: honeypot, taxes, holder concentration, mint/freeze/ownership renounced, rug risk. Use before deciding a token is safe to buy.",
    command: ["token", "security"],
    parameters: { type: "object", properties: { chain, address }, required: ["chain", "address"], additionalProperties: false },
  },
  {
    name: "gmgn_token_pool",
    description: "Liquidity pool info: DEX, reserves, liquidity depth. Use to judge slippage / how deep the market is.",
    command: ["token", "pool"],
    parameters: { type: "object", properties: { chain, address }, required: ["chain", "address"], additionalProperties: false },
  },
  {
    name: "gmgn_token_holders",
    description: "Top token holders ranked by current balance, with P&L. Use for holder distribution / whale concentration.",
    command: ["token", "holders"],
    parameters: {
      type: "object",
      properties: {
        chain, address, limit,
        tag: { type: "string", description: "Filter holders by wallet tag: smart_degen, renowned, sniper, bundler, rat_trader." },
        order_by: { type: "string", description: "Field to sort by (e.g. profit, amount)." },
        direction: { type: "string", enum: ["asc", "desc"], description: "Sort direction." },
      },
      required: ["chain", "address"], additionalProperties: false,
    },
  },
  {
    name: "gmgn_token_traders",
    description: "Top token traders (current holders + past traders) with P&L. Use to see who is winning/losing on this token.",
    command: ["token", "traders"],
    parameters: {
      type: "object",
      properties: {
        chain, address, limit,
        tag: { type: "string", description: "Filter traders by wallet tag: smart_degen, renowned, sniper, bundler, rat_trader." },
        order_by: { type: "string", description: "Field to sort by (e.g. profit, amount)." },
        direction: { type: "string", enum: ["asc", "desc"], description: "Sort direction." },
      },
      required: ["chain", "address"], additionalProperties: false,
    },
  },

  // ---- market ----
  {
    name: "gmgn_market_kline",
    description: "OHLCV / candlestick (K-line) data for a token. Use for price history / charting. 'volume' is USD value, 'amount' is token units.",
    command: ["market", "kline"],
    parameters: {
      type: "object",
      properties: {
        chain, address,
        resolution: { type: "string", enum: ["30s", "1m", "5m", "15m", "1h", "4h", "1d"], description: "Candle interval." },
        from: { type: "integer", description: "Start time, unix seconds (optional)." },
        to: { type: "integer", description: "End time, unix seconds (optional)." },
      },
      required: ["chain", "address", "resolution"], additionalProperties: false,
    },
  },
  {
    name: "gmgn_market_trending",
    description: "Trending tokens ranked by trading activity. Use for 'what's pumping / hot coins right now'.",
    command: ["market", "trending"],
    parameters: {
      type: "object",
      properties: {
        chain,
        interval: { type: "string", enum: ["1m", "5m", "1h", "6h", "24h"], description: "Trending window." },
        limit,
      },
      required: ["chain"], additionalProperties: false,
    },
  },
  {
    name: "gmgn_market_trenches",
    description: "Launchpad tokens by lifecycle stage: new_creation, near_completion, completed. Use for 'new launches / early gems on pump.fun etc'.",
    command: ["market", "trenches"],
    parameters: {
      type: "object",
      properties: {
        chain,
        type: { type: "string", enum: ["new_creation", "near_completion", "completed"], description: "Lifecycle stage filter." },
      },
      required: ["chain"], additionalProperties: false,
    },
  },
  {
    name: "gmgn_market_signal",
    description: "Token signals: price spikes, smart-money buys, large buys, etc. SOL and BSC only. Use for 'live alpha signals'.",
    command: ["market", "signal"],
    parameters: {
      type: "object",
      properties: {
        chain: { type: "string", enum: ["sol", "bsc"], description: "Only sol or bsc are supported for signals." },
        signal_type: { type: "string", description: "Signal category to query." },
        limit,
      },
      required: ["chain"], additionalProperties: false,
    },
  },
  {
    name: "gmgn_market_hot_searches",
    description: "Hot-search ranking (most-searched tokens). Use for 'what is everyone searching / trending in attention'.",
    command: ["market", "hot-searches"],
    parameters: {
      type: "object",
      properties: {
        chain,
        interval: { type: "string", enum: ["1m", "5m", "1h", "6h", "24h"], description: "Ranking window." },
      },
      required: [], additionalProperties: false,
    },
  },

  // ---- portfolio ----
  {
    name: "gmgn_portfolio_info",
    description: "List wallets and main-currency balances bound to the configured API key. Use for 'my wallets / my balances'. Takes no arguments.",
    command: ["portfolio", "info"],
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "gmgn_portfolio_holdings",
    description: "Token holdings of a wallet. Use for 'what does this wallet hold'.",
    command: ["portfolio", "holdings"],
    parameters: { type: "object", properties: { chain, wallet }, required: ["chain", "wallet"], additionalProperties: false },
  },
  {
    name: "gmgn_portfolio_activity",
    description: "Transaction activity of a wallet. Use for 'this wallet's recent trades / history'.",
    command: ["portfolio", "activity"],
    parameters: { type: "object", properties: { chain, wallet }, required: ["chain", "wallet"], additionalProperties: false },
  },
  {
    name: "gmgn_portfolio_stats",
    description: "Trading stats for a wallet: realized/unrealized P&L, win rate, performance. Use to decide whether to copy-trade a wallet.",
    command: ["portfolio", "stats"],
    parameters: { type: "object", properties: { chain, wallet }, required: ["chain", "wallet"], additionalProperties: false },
  },
  {
    name: "gmgn_portfolio_token_balance",
    description: "A wallet's balance of one specific token. Use for 'how much of token X does wallet Y hold'.",
    command: ["portfolio", "token-balance"],
    parameters: { type: "object", properties: { chain, wallet, address }, required: ["chain", "wallet", "address"], additionalProperties: false },
  },
  {
    name: "gmgn_portfolio_created_tokens",
    description: "Tokens created by a developer wallet, with ATH market cap and graduation status. Use for 'what has this dev launched before'.",
    command: ["portfolio", "created-tokens"],
    parameters: { type: "object", properties: { chain, wallet }, required: ["chain", "wallet"], additionalProperties: false },
  },

  // ---- track ----
  {
    name: "gmgn_track_follow_tokens",
    description: "Tokens a wallet has followed (bookmarked) on GMGN. Use for 'what tokens has this wallet bookmarked'.",
    command: ["track", "follow-tokens"],
    parameters: { type: "object", properties: { chain, wallet }, required: ["chain", "wallet"], additionalProperties: false },
  },
  {
    name: "gmgn_track_follow_wallet",
    description: "Trade records from followed wallets. Use for 'what are the wallets I follow doing'.",
    command: ["track", "follow-wallet"],
    parameters: { type: "object", properties: { chain, wallet }, required: ["chain"], additionalProperties: false },
  },
  {
    name: "gmgn_track_kol",
    description: "Recent KOL / influencer wallet trades. Use for 'what are KOLs buying'.",
    command: ["track", "kol"],
    parameters: { type: "object", properties: { chain }, required: ["chain"], additionalProperties: false },
  },
  {
    name: "gmgn_track_smartmoney",
    description: "Recent Smart Money wallet trades. Use for 'what is smart money buying'.",
    command: ["track", "smartmoney"],
    parameters: { type: "object", properties: { chain }, required: ["chain"], additionalProperties: false },
  },
];
