# Backend Update: Enhanced Blog Content Features

**Date:** January 21, 2026  
**API Version:** No changes - Same endpoints, same schema

---

## What's New

Two new features are now automatically included in enhanced articles:

### 1. 🔗 Internal Links (SEO Boost)

Enhanced articles now contain **2-4 contextual internal links** to related content.

**Format:** Standard Markdown links
```markdown
As [Mitchell Marsh's leadership](/news/mitchell-marsh-leadership-style) continues to impress...
```

**Rendering:** Your existing Markdown renderer already handles these. No changes needed.

---

### 2. 📱 Social Media Embeds (Fixed Format)

Instagram and Twitter embeds now use the **correct placeholder format** in the enhanced content markdown.

**Format:**
```
[INSTAGRAM:ABC123xyz]
[TWEET:1234567890123456789]
```

**Example in content:**
```markdown
## Match Highlights

Australia dominated with the bat...

[INSTAGRAM:DTvX1S2kv_N]

The victory secures their place in the Super Six...
```

---

## How to Render Embeds

If you're not already handling these placeholders, here's the pattern:

```jsx
// React example - parse markdown and render embeds
const parts = content.split(/\[(TWEET|INSTAGRAM):([A-Za-z0-9_-]+)\]/);

// parts array: ["text", "INSTAGRAM", "ABC123", "more text", "TWEET", "12345", ...]
```

See existing guide: `FRONTEND_BLOG_GUIDE.md` or `ICC_TWEET_INTEGRATION_GUIDE.md`

---

## No Action Required If...

✅ You already render `[TWEET:ID]` and `[INSTAGRAM:ID]` placeholders  
✅ You already render Markdown links `[text](url)`

---

## Summary

| Feature | Format | Frontend Change |
|---------|--------|-----------------|
| Internal Links | `[anchor](/news/slug)` | None |
| Instagram Embeds | `[INSTAGRAM:ID]` | None* |
| Twitter Embeds | `[TWEET:ID]` | None* |

*If already implemented per existing guide

---

**Questions?** The API response schema is unchanged. These are just content improvements inside the `full_blog_post_markdown` field.
