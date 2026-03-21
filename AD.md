## **ScrapChat — Self-hosted LLM workbench with sandboxed applets, prompt-based tool calling, and E*TRADE integration (llama.cpp + vanilla JS)**

I built a self-hosted chat UI that connects to a local llama.cpp server and turns it into a financial analysis workbench. No frameworks, no cloud dependencies, no bundler — just Express, vanilla JS, and a lot of prompt engineering.

**What makes it different from every other chat UI:**

### Prompt-Based Tool Calling (works with ANY local model)
No OpenAI function-calling API required. The system prompt teaches the model to emit `<tool_call>` XML blocks with JSON arguments. This means Qwen, Llama, Mistral, DeepSeek — anything running on llama.cpp can use tools out of the box.

The backend includes **40+ JSON repair strategies** for when models produce broken output — unbalanced braces, Python-style booleans (`True`/`False`), missing quotes, literal newlines in code arguments. It just works.

### Inline Applet System (sandboxed visualizations inside chat)
The LLM can generate `<applet type="html|chartjs|svg">` blocks directly in its response. These render as **sandboxed iframes** in the chat bubble — full interactive Chart.js charts, HTML dashboards, SVG diagrams, right inline with the conversation.

- Chart.js bundled locally (no CDN)
- `sandbox="allow-scripts"` only — fully isolated from parent DOM
- 50KB cap per applet, auto-resize via ResizeObserver + postMessage (100-2000px height range)
- **Applet templates**: Save any applet as a reusable template with a gold "Save as Template" button below each applet. Reference it in future prompts with `[template: name]`, and the LLM reuses the layout with fresh data
- **Mermaid diagrams**: Full Mermaid v11 support — flowcharts, pie charts, xychart-beta (bar/line), timelines, mindmaps, Gantt charts, sequence diagrams — all rendered inline with dark theme

### 20-Round Tool Loop with Safety Rails
The backend runs up to 20 rounds of tool execution before forcing a final answer:
- **Per-signature repeat detection** — only truly identical calls (same tool + same args) count toward the limit
- **Max 4 parallel tools per round** to prevent context explosion
- **Options-analysis safeguard** — detects when the LLM fetches option expiry dates but forgets to fetch the actual chains, forces continuation
- **Large result auto-save** — big tool results get saved to CSV, only a summary goes to the LLM context

### E*TRADE Integration (Read-Only)
Full brokerage data access without write permissions:
- Portfolio with full Greeks (Delta, Gamma, Theta, Vega, IV) for options positions
- Option chains across multiple expiries with auto-pagination
- Transaction history with auto-fetching all pages
- Account resolution by description ("IRA", "brokerage") — no need to memorize encoded keys
- Strict data integrity rules in the system prompt: no rounding, no interpolating strikes, no fabricating Greeks

### Python Execution with Smart File Detection
- Scripts run in `data/` directory, auto-detects new files created during execution
- System prompt enforces vectorized pandas (no `iterrows()`, no for-loops on DataFrames)
- 120s timeout, 2MB output buffer
- Generated PNGs/CSVs/HTML get download URLs automatically

### LiteAPI Travel Agent
Built-in travel assistant with real booking capabilities:
- **Hotel search** with semantic search, rates, reviews, and availability
- **Travel data** — weather, places, countries, cities, IATA codes, price index
- **Full booking flow** — prebook → book → manage bookings → cancel
- Not a demo — actual hotel reservations through LiteAPI

### Other Features
- **Dual LLM backend**: Switch between llama.cpp and Claude API at runtime from the status bar dropdown — no restart needed
- **Prompt library** with variable substitution — `{$Ticker}`, `{$Period:daterange}`, `{$Month:month}`, `{$Date:date}` show typed input modals with flatpickr calendar pickers. Drag-and-drop reordering of saved prompts
- **Dual search engines** (Keiro + Tavily) switchable at runtime via status bar dropdown
- **Web fetch** with Readability + Turndown for clean markdown extraction
- **Slot management** — visual slot cards showing context usage, pin/unpin conversations to specific llama.cpp slots
- **Vision support** — paste, drag-and-drop, or button-upload images; preview thumbnails with delete; click to expand in full-screen modal
- **Qwen3 reasoning** — thinking tokens stream in real-time, rendered as collapsible "Thinking" blocks in the UI
- **Shell command execution** with user confirmation prompt (120s timeout, auto-deny on expiry)
- **Autorun mode** — checkbox to skip Python confirmation for trusted workflows; `run_command` always requires approval regardless
- **Tool call logging** — every tool invocation logged to daily files with full I/O, args, and formatted results
- **Tool toggle UI** — enable/disable individual tools at runtime from the Tools dropdown without restarting
- **Tool usage history** — collapsible dropdown showing all tool calls in the current conversation with result metadata
- **Syntax highlighting** — all code blocks auto-highlighted with highlight.js, dark theme
- **HTML sanitization** — all rendered content sanitized via DOMPurify
- **Context bar** — live token usage visualization showing current consumption vs max context
- **E*TRADE OAuth** — browser-based OAuth 1.0a flow, tokens held in-memory only (never written to disk), sandbox mode for testing

### Things You Can Actually Do With It

**"Show me AAPL call options for next week, filter by volume"**
→ LLM fetches option expiries, pulls chains with full Greeks, builds an interactive HTML dashboard right in the chat — with dropdowns for expiry date and call/put filtering. Save the dashboard as a template, reuse it for any ticker next time.

**"Show my E*TRADE account balances"**
→ One prompt, LLM calls the API, renders a styled HTML applet with all your accounts, balances, and allocations inline. No copy-pasting into spreadsheets.

**"Generate an option chain dashboard for AMD, let me pick expiry and call/put"**
→ LLM downloads all option chain data to CSVs, then generates an applet that loads those files dynamically — select an expiry from a dropdown, toggle call/put, and the table updates live inside the chat bubble.

**"What's the weather in Tokyo next week? Find me a hotel under $200"**
→ LiteAPI travel tools kick in — real weather data, hotel search with rates and reviews, and you can actually book it right from the chat.

**"Analyze my short selling P&L for Q1"**
→ LLM fetches all transactions (auto-paginates every page), saves to CSV, writes a Python script to pair short/cover trades, calculates realized P&L, and outputs a downloadable report.

**Save a prompt like:** `Show {$Ticker} options for {$Period:daterange}`
→ Next time you click it, a modal pops up with a text field for the ticker and a flatpickr calendar range picker. Fill in, hit Apply, done.

**"Search for latest Fed rate decision and summarize"**
→ Web search (Keiro or Tavily), then auto-fetches the top result with Readability for clean markdown extraction, then summarizes.

**"Draw a flowchart of my options strategy"**
→ LLM generates a Mermaid flowchart diagram rendered inline — dark themed, supports flowcharts, timelines, Gantt charts, sequence diagrams, and more.

**"Plot my portfolio allocation"**
→ LLM fetches your holdings, generates a Chart.js pie/bar chart rendered as an interactive applet right in the chat bubble. No screenshots, no external tools.

**Drag an image into the chat and ask "What stock is shown in this chart?"**
→ Vision support sends the image to the LLM for analysis — works with llama.cpp multimodal models and Claude API.

### The System Prompt
260+ lines of carefully tuned instructions covering:
- Financial data integrity (never fabricate strikes or Greeks)
- Correct options reasoning (IV reflects expected move, not moneyness)
- Python code patterns (groupby/agg, no row iteration)
- Multi-round workflow orchestration (fetch → save → compute → visualize)

### Tech Stack
- **Backend**: Node.js, Express v5, ES modules
- **Frontend**: Vanilla JS (~1800 lines, single file), Tailwind CSS v4
- **LLM**: llama.cpp (OpenAI-compatible endpoint) or Claude API
- **No TypeScript, no React, no bundler**

### Quick Start
```
cp .env.example .env
# edit LLAMA_URL to point at your llama-server
npm install && npm run css:build && npm run dev
```
