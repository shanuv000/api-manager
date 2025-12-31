# News Scrapers - Frontend Content Rendering Guide

**Updated:** December 30, 2025  
**Version:** 2.0

---

## Overview

This guide explains how content is formatted and structured by each news scraper, and how your frontend should handle the different content types.

---

## Content Sources

| Source        | Scraper File                        | Content Format    |
| ------------- | ----------------------------------- | ----------------- |
| ICC Cricket   | `icc-news-scraper.js`               | Markdown + Embeds |
| ESPN Cricinfo | `espncricinfo-puppeteer-scraper.js` | Markdown + Embeds |
| BBC Sport     | `bbc-cricket-scraper.js`            | Markdown          |
| Cricbuzz      | `cricbuzz-news-scraper.js`          | Plain Text        |
| IPL T20       | `iplt20-news-scraper.js`            | Markdown + IG     |

---

## Feature Comparison

| Feature                           | ICC | ESPN | BBC | Cricbuzz | IPL |
| --------------------------------- | --- | ---- | --- | -------- | --- |
| **Markdown Headers**              | ✅  | ✅   | ✅  | ❌       | ✅  |
| **Markdown Links**                | ✅  | ✅   | ✅  | ❌       | ✅  |
| **Bold/Italic**                   | ✅  | ✅   | ✅  | ❌       | ✅  |
| **Inline Tweet Placeholders**     | ✅  | ✅   | ❌  | ❌       | ❌  |
| **Inline Instagram Placeholders** | ✅  | ✅   | ❌  | ❌       | ❌  |
| **Tables**                        | ✅  | ✅   | ❌  | ❌       | ✅  |
| **Lists**                         | ✅  | ✅   | ✅  | ❌       | ✅  |
| **embeddedTweets Array**          | ✅  | ✅   | ✅  | ❌       | ❌  |
| **embeddedInstagram Array**       | ✅  | ✅   | ❌  | ❌       | ✅  |

---

## Content Placeholders

### Twitter Embeds

**Format:** `[TWEET:1234567890123456789]`

- The ID is a 15-20 digit number
- Appears inline where the tweet was in the original article
- **Inline placeholders available in:** ICC, ESPN Cricinfo
- **Note:** BBC provides `embeddedTweets` array but does NOT include inline placeholders in content

**Rendering Example:**

```jsx
import { TwitterTweetEmbed } from "react-twitter-embed";

// Replace placeholder with actual embed
if (content.includes("[TWEET:")) {
  const tweetId = content.match(/\[TWEET:(\d+)\]/)[1];
  return <TwitterTweetEmbed tweetId={tweetId} />;
}
```

---

### Instagram Embeds

**Format:** `[INSTAGRAM:ABC123xyz]`

- The ID is an alphanumeric shortcode (11 characters)
- Appears inline where the Instagram post/reel was in original article
- Available in: ICC, ESPN Cricinfo

**Rendering Example:**

```jsx
function InstagramEmbed({ postId }) {
  return (
    <iframe
      src={`https://www.instagram.com/p/${postId}/embed`}
      width="400"
      height="500"
      frameBorder="0"
      scrolling="no"
      loading="lazy"
    />
  );
}
```

---

## Markdown Content

### Headers

```markdown
# Main Title (H1)

## Section Title (H2)

### Subsection (H3)
```

**Note:** The article title is usually the first `# ` header in content.

---

### Links

```markdown
[Player Name](https://www.espncricinfo.com/cricketers/virat-kohli-253802)
[Match Link](https://www.espncricinfo.com/series/.../full-scorecard)
```

**Rendering:**

```jsx
import ReactMarkdown from "react-markdown";

<ReactMarkdown
  components={{
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
  }}
>
  {content}
</ReactMarkdown>;
```

---

### Bold & Italic

```markdown
**Bold text**
_Italic text_
```

---

### Tables (ICC, ESPN)

```markdown
| Player       | Runs | Average |
| ------------ | ---- | ------- |
| Virat Kohli  | 1000 | 55.5    |
| Rohit Sharma | 850  | 47.2    |
```

---

### Lists

```markdown
- Bullet point 1
- Bullet point 2

1. Numbered item 1
2. Numbered item 2
```

---

## API Response Fields

### Standard Fields (All Sources)

```typescript
interface NewsArticle {
  id: string;
  slug: string;
  title: string;
  description: string;
  content: string; // Main article content
  imageUrl: string; // Main hero image
  thumbnailUrl: string;
  sourceUrl: string; // Original article URL
  sourceName: string; // "ICC Cricket", "ESPN Cricinfo", etc.
  publishedTime: string; // ISO date
  tags: string[];
  metaTitle: string;
  metaDesc: string;
}
```

### Social Embed Fields (ICC, ESPN, BBC, IPL)

```typescript
interface NewsArticleWithEmbeds extends NewsArticle {
  embeddedTweets: string[]; // Array of tweet IDs
  embeddedInstagram: InstagramEmbed[]; // Array of Instagram objects
}

interface InstagramEmbed {
  id: string; // "ABC123xyz"
  type: string; // "p" (post) or "reel"
  url: string; // Full Instagram URL
}
```

---

## Complete Rendering Component

```jsx
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TwitterTweetEmbed } from "react-twitter-embed";

function ArticleContent({ content, sourceName }) {
  // Check if source supports markdown
  const supportsMarkdown = [
    "ICC Cricket",
    "ESPN Cricinfo",
    "BBC Sport",
    "IPL T20",
  ].includes(sourceName);

  if (!supportsMarkdown) {
    // Plain text - just render paragraphs
    return (
      <div className="prose">
        {content.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    );
  }

  // Split by embed placeholders
  const parts = content.split(/(\[TWEET:\d+\]|\[INSTAGRAM:[A-Za-z0-9_-]+\])/);

  return (
    <article className="prose prose-lg max-w-none">
      {parts.map((part, idx) => {
        // Twitter embed
        const tweetMatch = part.match(/\[TWEET:(\d+)\]/);
        if (tweetMatch) {
          return (
            <div key={idx} className="my-8 flex justify-center">
              <TwitterTweetEmbed tweetId={tweetMatch[1]} />
            </div>
          );
        }

        // Instagram embed
        const igMatch = part.match(/\[INSTAGRAM:([A-Za-z0-9_-]+)\]/);
        if (igMatch) {
          return (
            <div key={idx} className="my-8 flex justify-center">
              <iframe
                src={`https://www.instagram.com/p/${igMatch[1]}/embed`}
                width="400"
                height="500"
                frameBorder="0"
                loading="lazy"
              />
            </div>
          );
        }

        // Regular markdown content
        if (part.trim()) {
          return (
            <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]}>
              {part}
            </ReactMarkdown>
          );
        }

        return null;
      })}
    </article>
  );
}

export default ArticleContent;
```

---

## Styling Recommendations

### CSS for Article Content

```css
/* Base article styling */
.article-content {
  font-family: "Georgia", serif;
  line-height: 1.8;
  color: #1a1a1a;
}

/* Headers */
.article-content h1 {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.article-content h2 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 2rem 0 1rem;
  border-bottom: 1px solid #e5e5e5;
  padding-bottom: 0.5rem;
}

/* Links */
.article-content a {
  color: #2563eb;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.article-content a:hover {
  color: #1d4ed8;
}

/* Tables */
.article-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 2rem 0;
}

.article-content th,
.article-content td {
  border: 1px solid #e5e5e5;
  padding: 0.75rem 1rem;
  text-align: left;
}

.article-content th {
  background: #f9fafb;
  font-weight: 600;
}

/* Social embeds */
.tweet-container,
.instagram-container {
  display: flex;
  justify-content: center;
  margin: 2rem 0;
}

/* Image captions */
.article-content p:has(•) {
  font-style: italic;
  color: #666;
  font-size: 0.9rem;
}
```

---

## Image Handling

### Main Image

All sources provide a main hero image in the `imageUrl` field. Display this at the top of the article:

```jsx
function ArticleHero({ imageUrl, title }) {
  return (
    <figure className="mb-8">
      <img
        src={imageUrl}
        alt={title}
        className="w-full rounded-lg"
        loading="eager"
      />
    </figure>
  );
}
```

### Image Captions

Image captions are included as text in the content, typically formatted as:

```
Player Name in action for Team • Getty Images
```

These can be styled with CSS to appear as captions.

---

## Source-Specific Notes

### ICC Cricket

- Rich markdown with inline social embeds
- May include both tweets and Instagram posts
- Best content formatting overall

### ESPN Cricinfo

- Rich markdown with extensive internal links
- Links to player profiles, match scorecards, series pages
- May include tweets and Instagram reels
- Image captions included as text

### BBC Sport

- Clean markdown formatting
- Provides `embeddedTweets` array with tweet IDs
- **No inline `[TWEET:]` placeholders** - you must render tweets separately using the `embeddedTweets` array
- No Instagram embeds
- Good for UK/international cricket news

### Cricbuzz

- Plain text paragraphs only
- No markdown formatting
- Split by `\n\n` for paragraphs

### IPL T20

- Full markdown support (headers, links, bold, lists, tables)
- Provides `embeddedInstagram` array for Instagram embeds
- **No inline placeholders** - render Instagram separately using the `embeddedInstagram` array
- May include PDF links and scorecard links
- IPL-specific news, auction updates, match reports

---

## Testing Articles

### ICC with Twitter + Instagram

```
GET /api/cricket/news?slug=ireland-name-squad-for-icc-women-s-t20wc-global-qualifier
```

### ESPN with Twitter + Instagram

```
GET /api/cricket/news?slug=super-smash-2025-26-glenn-phillips-brings-out-the-switch-cover-drive-1517556
```

### ESPN with Many Links

```
GET /api/cricket/news?slug=stats-virat-kohli-and-rohit-sharma-s-vijay-hazare-trophy-comeback-and-the-list-a-odi-disconnect-1517446
```

---

## Questions?

Contact the backend team for API-specific questions or to request additional content formatting features.
