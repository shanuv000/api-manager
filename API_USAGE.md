# How to Use the Antigravity Proxy API

This proxy emulates the **Anthropic API**, allowing you to use it with any tool or library that supports Claude 3.5 Sonnet, Opus, or Haiku.

## 🔑 Connection Details

| Setting | Value |
| :--- | :--- |
| **Base URL** | `https://ai.urtechy.com` |
| **API Key** | `agp_9dS82kP1J7xWmQZs` |
| **Provider Type** | Anthropic (Standard) |

> [!NOTE]
> This key is private. Do not share it publicly.

---

## 🤖 Supported Models

You can use Claude-style names or native Gemini names. Both work identically.

| Model Name | Family | Description |
| :--- | :--- | :--- |
| `claude-3-5-sonnet-20241022` | Claude | Standard model. Works with most clients. |
| `claude-sonnet-4-5` | Claude | Higher intelligence, slightly slower. |
| `claude-sonnet-4-5-thinking` | Claude | Reasoning model with thinking output. |
| `claude-opus-4-5-thinking` | Claude | **Maximum Intelligence**. Deep reasoning. |
| `gemini-2.5-flash` | Gemini | Fast, low latency. |
| `gemini-2.5-flash-thinking` | Gemini | Fast with reasoning output. |
| `gemini-3-flash` | Gemini | Extremely fast. |
| `gemini-3-pro-low` | Gemini | Balanced speed/intelligence. |
| `gemini-3-pro-high` | Gemini | **Most Powerful**. Deep reasoning. |

> [!TIP]
> **Fallback Logic:**
> 1. First, the proxy tries **other accounts** with the same model.
> 2. Only when **ALL accounts** are exhausted does it fall back to an equivalent model in the other family (e.g. `gemini-3-pro-high` → `claude-opus-4-5-thinking`).

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
  "model": "claude-3-5-sonnet-20241022",
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
5.  **Model**: Select `claude-3-5-sonnet-20241022` (or your preferred model).

### 3. Aider (CLI)
Run the following commands in your terminal:

```bash
export ANTHROPIC_API_KEY=agp_9dS82kP1J7xWmQZs
export ANTHROPIC_API_BASE=https://ai.urtechy.com

aider --model claude-3-5-sonnet-20241022
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
    model="claude-3-5-sonnet-20241022",
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
    model: 'claude-3-5-sonnet-20241022',
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
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
        {"role": "user", "content": "Hello world"}
    ]
  }'
```

---

## 🚦 Troubleshooting

| Error Code | Meaning | Fix |
| :--- | :--- | :--- |
| **401 Unauthorized** | Invalid API Key | Check that your `x-api-key` matches the one in config. |
| **403 Forbidden** | WAF / Quota | You may be blocked by Cloudflare (check IP) or hitting internal rate limits. |
| **502 Bad Gateway** | Service Down | Nginx cannot talk to the proxy. Run `sudo systemctl status antigravity-proxy`. |
| **504 Timeout** | Processing Delay | The request took too long (>300s). Retry. |
| **Request Hangs** | Rate Limit Wait | All accounts are rate-limited. The proxy waits up to **2 minutes** (`maxWaitBeforeErrorMs: 120000`) for quota to reset before failing. Use a Gemini model instead or wait. |

> [!WARNING]
> If requests hang for ~2 minutes then fail, it means all accounts are exhausted for that model. Try `gemini-3-flash` or `gemini-3-pro-high` which have separate quotas.

