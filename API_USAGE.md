# How to Use the Antigravity Proxy API

This proxy emulates the **Anthropic API**, allowing you to use Claude and Gemini models with any Anthropic-compatible tool.

**Version**: v2.7.6 (Feb 2026)

## 🔑 Connection Details

| Setting | Value |
| :--- | :--- |
| **Base URL** | `https://ai.urtechy.com` |
| **API Key** | `agp_9dS82kP1J7xWmQZs` |
| **Provider Type** | Anthropic (Standard) |

> [!NOTE]
> This key is private. Do not share it publicly.

---

## 🤖 Supported Models (12 Total)

| Model | Family | Latency | Best For |
| :--- | :--- | ---: | :--- |
| `gemini-2.5-flash-lite` | Gemini | ~1.3s | ⚡ Fastest, light tasks |
| `gemini-2.5-flash` | Gemini | ~1.3s | Fast general use |
| `gemini-2.5-flash-thinking` | Gemini | ~1.5s | Fast reasoning |
| `gemini-3-flash` | Gemini | ~2.4s | Balanced speed |
| `gemini-3-pro-low` | Gemini | ~3.4s | Cost-efficient |
| `gemini-3-pro-high` | Gemini | ~7.4s | High intelligence |
| `gemini-3.1-pro-low` | Gemini | ~0.7s | Cost-efficient (newer) |
| `gemini-3.1-pro-high` | Gemini | ~0.7s | High intelligence (newer) |
| `gemini-3-pro-image` | Gemini | ~15s (T/O)| Vision tasks |
| `gemini-2.5-pro` | Gemini | ~15s (T/O)| Deep reasoning |
| `claude-sonnet-4-6` | Claude | ~1.1s | Creative writing |
| `claude-opus-4-6-thinking` | Claude | ~1.5s | **Latest Opus** |

> [!IMPORTANT]
> **🔓 Unlimited Usage**: All models have unlimited usage via 11 pooled accounts with automatic failover.

> [!TIP]
> **Model Selection Guide:**
> - **Speed Priority**: Use `gemini-2.5-flash-lite` or `gemini-2.5-flash`
> - **Balanced**: Use `gemini-3-flash` or `claude-sonnet-4-5-thinking`
> - **Deep Reasoning**: Use `claude-opus-4-5-thinking` or `gemini-3-pro-high`

> [!NOTE]
> All models support streaming with `"stream": true` and thinking with the `thinking` parameter.


## 🎭 Roles & Message Structure

The API follows the standard Anthropic Message format.

| Role | Description | Code Example |
| :--- | :--- | :--- |
| `user` | The human input. | `{"role": "user", "content": "Hello"}` |
| `assistant` | The AI response (or pre-fill). | `{"role": "assistant", "content": "Here is the code:"}` |
| `system` | **Top-level parameter**. Instructions for how the AI should behave. | Passed as `system: "You are a coding expert..."` in the JSON body. |

**Example with System Prompt:**
```json
{
  "model": "claude-sonnet-4-5",
  "system": "You are a concise assistant.",
  "messages": [
    {"role": "user", "content": "Explain quantum computing."}
  ]
}
```

---

## 🛠️ Tool Configuration

### 1. Cursor (VS Code Fork)
1.  Open **Settings** (Gear icon) > **Models**.
2.  Scroll to **Anthropic**.
3.  Enable **"Override API Base URL"**.
4.  Enter Base URL: `https://ai.urtechy.com`
5.  Enter your **API Key**.
6.  Click **Verify**.

### 2. Cline / Roo Code / Enforce
1.  Open the Extension Settings.
2.  Select **API Provider**: `Anthropic`.
3.  **Base URL**: `https://ai.urtechy.com`
4.  **API Key**: `agp_9dS82kP1J7xWmQZs`
5.  **Model**: Select `claude-sonnet-4-6` (or your preferred model).

### 3. Aider (CLI)
Run the following commands in your terminal:

```bash
export ANTHROPIC_API_KEY=agp_9dS82kP1J7xWmQZs
export ANTHROPIC_API_BASE=https://ai.urtechy.com

aider --model claude-sonnet-4-6
```

---

## 💻 Code Examples

### Python (Anthropic SDK)
You can use the standard `anthropic` library without modification, just change the client config.

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://ai.urtechy.com",
    api_key="agp_9dS82kP1J7xWmQZs"
)

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1000,
    messages=[
        {"role": "user", "content": "Hello, are you working?"}
    ]
)

print(message.content)
```

### Node.js (Anthropic SDK)
```javascript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  baseURL: 'https://ai.urtechy.com',
  apiKey: 'agp_9dS82kP1J7xWmQZs', 
});

async function main() {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello, world' }],
  });

  console.log(message.content);
}

main();
```

### cURL (Terminal)
```bash
curl https://ai.urtechy.com/v1/messages \
  -H "x-api-key: agp_9dS82kP1J7xWmQZs" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "gemini-3-flash",
    "max_tokens": 1024,
    "messages": [
        {"role": "user", "content": "Hello world"}
    ]
  }'
```

### cURL with Streaming
```bash
curl https://ai.urtechy.com/v1/messages \
  -H "x-api-key: agp_9dS82kP1J7xWmQZs" \
  -H "content-type: application/json" \
  -d '{
    "model": "gemini-2.5-flash-lite",
    "max_tokens": 500,
    "stream": true,
    "messages": [{"role": "user", "content": "Count to 10"}]
  }'
```

---

## 🚦 Troubleshooting

| Error Code | Meaning | Fix |
| :--- | :--- | :--- |
| **401 Unauthorized** | Invalid API Key | Check that your `x-api-key` matches the one in config. |
| **403 Forbidden** | WAF / Quota | You may be blocked by Cloudflare (check IP) or hitting internal rate limits. |
| **429 Rate Limited** | Quota exhausted | Proxy will auto-retry with backoff. Switch to Gemini models if Claude is exhausted. |
| **502 Bad Gateway** | Service Down | Nginx cannot talk to the proxy. Run `sudo systemctl status antigravity-proxy`. |
| **504 Timeout** | Processing Delay | The request took too long (>300s). Retry with a faster model. |

> [!WARNING]
> If requests hang for ~2 minutes then fail, all accounts are exhausted. Try `gemini-2.5-flash-lite` which has the fastest response time (~900ms).

---

## ✨ v2.7.6 Features
- **Enhanced Client Identification**: Intelligent Antigravity version detection and dynamic User-Agent generation
- **Session ID Support**: Improved message handling with session ID support and updated headers
- **Smart Rate Limiting**: Auto-backoff with deduplication prevents thundering herd
- **Model Validation**: Invalid model IDs rejected before processing
- **Streaming**: Full SSE support with `"stream": true`
- **HTTP Proxy**: Set `HTTP_PROXY` env var for corporate networks
- **Fallback Logic**: Auto-switches between accounts, then model families
- **Server Config Presets**: Create, edit, and manage configuration presets from WebUI
- **Hot-Reload Strategy**: Change account selection strategy without restarting
- **Claude Opus 4.6**: New model `claude-opus-4-6-thinking` supported
- **Capacity Exhaustion Fix**: Proper cooldown for exhausted accounts

---

## 🚀 Production Status

| Component | Status |
| :--- | :--- |
| **Systemd Service** | ✅ Active, auto-restart enabled |
| **Boot Startup** | ✅ Enabled |
| **Discord Alerts** | ✅ Configured for start/stop/fail |
| **Public URL** | ✅ `ai.urtechy.com` |

### Service Commands
```bash
# Check status
sudo systemctl status antigravity-proxy

# View logs
sudo journalctl -u antigravity-proxy -f

# Restart
sudo systemctl restart antigravity-proxy

# Discord notification
./scripts/discord-notify.sh start|stop|fail
```
