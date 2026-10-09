# Stock Watch

Static dashboard of low-priced (\$0.50–\$10), high-volume US stocks with big daily moves, plus simple technical signals (SMA 9/20, RSI 14, VWAP) and a heuristic bullish/bearish score.

**Live:** https://holydog413.github.io/stock-watch/

## How it works
- `scripts/fetch_data.py` (stdlib Python) pulls Yahoo Finance's public screener (`day_gainers`, `day_losers`, `most_actives`, `small_cap_gainers`, `aggressive_small_caps`) and 5-day/5-minute chart data for the top movers, filters to price \$0.50–\$10 and volume > 1M, and writes `data.json`.
- `.github/workflows/update.yml` runs it every 10 minutes on weekdays during US market hours (GitHub may delay scheduled runs) and deploys `site/` + `data.json` to GitHub Pages. No API keys.
- The page (`site/`) reads `data.json`, computes indicators in the browser, and auto-refreshes every 60 s.

## Disclaimer
Signals are heuristics describing recent price/volume behaviour, **not predictions or financial advice**. Data is delayed (typically ~15 min) and comes from unofficial endpoints that may change or rate-limit at any time.
