⚡ MirLite Bot — LitecoinEVM Testnet Automation
```
╔══════════════════════════════════════════════════════════╗
║          MirLite Testnet Automation Bot                 ║
║          LitecoinEVM Testnet Airdrop Hunter             ║
╚══════════════════════════════════════════════════════════╝
```
> 🟢 **LitecoinEVM Biggest Testnet** — Backed by Litecoin (Top 20 Crypto Project)
Automates all 9 testnet interaction steps for the MirLite / LitecoinEVM airdrop campaign.  
Creates unlimited wallets, saves private keys, and runs all tasks with human-like delays.
---
🚀 Quick Start
```bash
1 git clone https://github.com/dimmy-bit/lite-testnet.git
cd lite-testnet
python mirlite_bot.py

# 2. Run the bot
python mirlite_bot.py
```
> All required packages are **auto-installed** on first run. No manual `pip install` needed!
---
✅ What it Automates
Step	Platform	Task
1	LiteForge Hub	Connect wallet + claim test tokens
2	Lester Labs	Fill details + launch token
3	Midashand	Connect wallet + claim test tokens
4	Midashand Markets	Place a bet on any market
5	ONMI (LitVM)	Connect wallet + create token
6	ONMI Swap	Do multiple swaps
7	ONMI Liquidity	Add ZKLTC liquidity
8	ONMI Campaign	Complete campaign #4441 tasks
9	AyniLabs	Swap zkLTC → wzkLTC + Supply/Deposit
---
📋 Features
🎨 Animated ASCII banner with colour cycling
💼 Unlimited wallet creation — addresses + private keys saved to `wallets.json`
🔄 Resume support — already-completed tasks are skipped automatically
🧠 Human-like behaviour — random delays between actions (anti-detection)
📊 Balance checker — view tLTC + zkLTC balances per wallet
🎯 Per-step mode — run any single step on any/all wallets
🔒 Local storage — wallets never leave your machine
---
📂 File Structure
```
mirlite-bot/
├── mirlite_bot.py    ← Main bot script
├── wallets.json      ← Auto-created: all wallet data
├── task_logs.json    ← Auto-created: task completion logs
└── README.md
```
---
⚙️ Requirements
Python 3.8+
Internet connection
All Python packages are installed automatically:
`web3`, `eth-account`, `aiohttp`, `colorama`, `requests`, `rich`, `pyfiglet`
---
⚠️ Disclaimer
This tool is for educational purposes and interacting with testnets only.  
Never use real funds. Keep your `wallets.json` file safe — it contains private keys.  
The authors are not responsible for any misuse.
---
📬 Community
Built for the airdrop hunter community.  
Star ⭐ the repo if it helped you!
