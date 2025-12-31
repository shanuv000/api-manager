# ICC Cricket & ESPN Cricinfo Article Data - Frontend Integration Guide

**Report Date:** December 30, 2025  
**API Version:** v1.2 (+ ESPN Cricinfo Support)

---

## Overview

**ICC Cricket** and **ESPN Cricinfo** articles now include **inline social media placeholders** that allow you to render embedded tweets and Instagram posts exactly where they appear in the original article. This provides a much better user experience compared to rendering embeds at the end of the article.

### Supported Embeds

- ✅ **Twitter/X Tweets** - `[TWEET:ID]` placeholders
- ✅ **Instagram Posts/Reels** - `[INSTAGRAM:ID]` placeholders

---

## Data Structure

### API Response Example

```json
{
  "id": "cmjp5aynx0000uk8viyg2hkcf",
  "slug": "ireland-name-squad-for-icc-women-s-t20wc-global-qualifier",
  "title": "Ireland name squad for ICC Women's T20WC Global Qualifier",
  "content": "# Ireland name squad...\n\n[INSTAGRAM:DSw72CsDAHx]\n\nAs part of their build-up...\n\n[INSTAGRAM:DSAIpoUEkeW]\n\nIreland's group stage...",
  "embeddedTweets": [],
  "embeddedInstagram": [
    {
      "id": "DSw72CsDAHx",
      "type": "p",
      "url": "https://www.instagram.com/p/DSw72CsDAHx/"
    },
    {
      "id": "DSAIpoUEkeW",
      "type": "reel",
      "url": "https://www.instagram.com/reel/DSAIpoUEkeW/"
    }
  ],
  "sourceName": "ICC Cricket"
}
```

### Key Fields

| Field               | Type     | Description                                                          |
| ------------------- | -------- | -------------------------------------------------------------------- |
| `content`           | string   | Markdown content with `[TWEET:ID]` and `[INSTAGRAM:ID]` placeholders |
| `embeddedTweets`    | string[] | Array of tweet IDs                                                   |
| `embeddedInstagram` | object[] | Array of Instagram embed objects with `id`, `type`, and `url`        |
| `sourceName`        | string   | Always `"ICC Cricket"` for ICC articles                              |

---

## Placeholder Formats

### Twitter/X Tweets

```
[TWEET:1234567890123456789]
```

Where `1234567890123456789` is the Twitter/X tweet ID (15-20 digit number).

### Instagram Posts/Reels

```
[INSTAGRAM:ABC123xyz]
```

Where `ABC123xyz` is the Instagram post/reel shortcode (alphanumeric, 11 characters).

---

## Example Content Structure

```markdown
# Ireland name squad for ICC Women's T20WC Global Qualifier

#### Gaby Lewis will captain Ireland...

Ireland unveiled a 15-player squad for the upcoming ICC Women's T20 World Cup...

**Ireland Squad:** Gaby Lewis (C), Ava Canning, Christina Coulter Reilly...

[INSTAGRAM:DSw72CsDAHx]

As part of their build-up, the Irish squad will depart on 6 January 2026...

"The recent tour to South Africa demonstrated how tough international cricket can be..."

[INSTAGRAM:DSAIpoUEkeW]

Ireland's group stage fixtures:
18 January: v PNG
22 January: v USA
...
```

---

## React Implementation

### Install Dependencies

```bash
npm install react-markdown react-twitter-embed react-instagram-embed
# OR use iframe approach (no additional package needed)
```

### Universal Embed Rendering Component (Recommended)

```jsx
import React from "react";
import ReactMarkdown from "react-markdown";
import { TwitterTweetEmbed } from "react-twitter-embed";

/**
 * Renders ICC article content with inline tweets and Instagram embeds
 */
function ICCArticleContent({ content }) {
  // Split content by both tweet and instagram placeholders
  // This regex captures both types with their IDs
  const parts = content.split(/\[(TWEET|INSTAGRAM):([A-Za-z0-9_-]+)\]/);

  const elements = [];
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];

    // Check if this is a type indicator (TWEET or INSTAGRAM)
    if (part === "TWEET" && parts[i + 1]) {
      // Next part is the tweet ID
      const tweetId = parts[i + 1];
      elements.push(
        <div key={`tweet-${tweetId}`} className="my-8 flex justify-center">
          <TwitterTweetEmbed
            tweetId={tweetId}
            placeholder={<EmbedPlaceholder type="tweet" />}
          />
        </div>
      );
      i += 2; // Skip the ID
    } else if (part === "INSTAGRAM" && parts[i + 1]) {
      // Next part is the Instagram ID
      const igId = parts[i + 1];
      elements.push(
        <div key={`ig-${igId}`} className="my-8 flex justify-center">
          <InstagramEmbed postId={igId} />
        </div>
      );
      i += 2; // Skip the ID
    } else if (part && part.trim()) {
      // Regular markdown content
      elements.push(<ReactMarkdown key={`content-${i}`}>{part}</ReactMarkdown>);
      i++;
    } else {
      i++;
    }
  }

  return <article className="prose prose-lg max-w-none">{elements}</article>;
}

// Instagram embed using oEmbed iframe
function InstagramEmbed({ postId }) {
  return (
    <iframe
      src={`https://www.instagram.com/p/${postId}/embed`}
      width="400"
      height="500"
      frameBorder="0"
      scrolling="no"
      allowTransparency="true"
      className="mx-auto rounded-lg"
      loading="lazy"
    />
  );
}

// Loading placeholder component
function EmbedPlaceholder({ type }) {
  return (
    <div className="animate-pulse bg-gray-200 rounded-xl h-48 w-full max-w-lg flex items-center justify-center">
      <span className="text-gray-500">
        Loading {type === "tweet" ? "tweet" : "Instagram post"}...
      </span>
    </div>
  );
}

export default ICCArticleContent;
```

### Alternative: Simple Split Approach

If you prefer a simpler approach using regex split:

```jsx
function SimpleICCContent({ content }) {
  // Handle tweets first
  let parts = content.split(/\[TWEET:(\d+)\]/);

  return (
    <article>
      {parts.map((part, idx) => {
        if (idx % 2 === 1) {
          // Tweet ID
          return <TwitterTweetEmbed key={idx} tweetId={part} />;
        }

        // Check for Instagram in this part
        const igParts = part.split(/\[INSTAGRAM:([A-Za-z0-9_-]+)\]/);

        return igParts.map((igPart, igIdx) => {
          if (igIdx % 2 === 1) {
            // Instagram ID
            return (
              <InstagramEmbed key={`${idx}-ig-${igIdx}`} postId={igPart} />
            );
          }
          if (!igPart.trim()) return null;
          return (
            <ReactMarkdown key={`${idx}-md-${igIdx}`}>{igPart}</ReactMarkdown>
          );
        });
      })}
    </article>
  );
}
```

---

## CSS Styling

```css
/* Social embed containers */
.tweet-container,
.instagram-container {
  display: flex;
  justify-content: center;
  margin: 2rem 0;
}

/* Instagram iframe styling */
.instagram-container iframe {
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

/* Loading placeholder */
.embed-loading {
  width: 100%;
  max-width: 400px;
  height: 300px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 12px;
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .embed-loading {
    background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
  }
}
```

---

## API Endpoints

### Get ICC Articles

```
GET /api/cricket/news?source=icc
```

### Get Single Article by Slug

```
GET /api/cricket/news?slug=ireland-name-squad-for-icc-women-s-t20wc-global-qualifier
```

---

## Test Articles

### Article with Twitter Embeds

```
head-happy-at-the-top-backs-fellow-opener-to-fire-in-sydney
```

Contains: 2 tweets with `[TWEET:ID]` placeholders

### Article with Instagram Embeds

```
ireland-name-squad-for-icc-women-s-t20wc-global-qualifier
```

Contains: 2 Instagram posts with `[INSTAGRAM:ID]` placeholders

---

## Content Features by Source

| Feature                       | ICC Cricket | ESPN Cricinfo | BBC Sport | Cricbuzz |
| ----------------------------- | ----------- | ------------- | --------- | -------- |
| Inline Tweet Placeholders     | ✅          | ✅            | ✅        | ❌       |
| Inline Instagram Placeholders | ✅          | ✅            | ❌        | ❌       |
| Markdown Headings             | ✅          | ✅            | ✅        | ❌       |
| Markdown Links                | ✅          | ✅            | ✅        | ❌       |
| Bold Text                     | ✅          | ✅            | ✅        | ❌       |
| Tables                        | ✅          | ✅            | ❌        | ❌       |

---

## Best Practices

1. **Always use inline rendering** - Embeds lose context when placed at the end
2. **Add loading placeholders** - Social widgets take time to load
3. **Handle missing embeds gracefully** - Posts may be deleted
4. **Use lazy loading** - Add `loading="lazy"` to iframes
5. **Match your theme** - Use dark mode options where available
6. **Respect privacy** - Consider GDPR/cookie consent for embeds

---

## Questions?

Refer to the main [FRONTEND_BLOG_GUIDE.md](./FRONTEND_BLOG_GUIDE.md) for complete API documentation.
