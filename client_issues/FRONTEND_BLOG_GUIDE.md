# Frontend Blog/News Data Handling Guide

**Report Date:** December 23, 2025  
**API Version:** v1  
**Last Updated:** December 23, 2025

---

## 1. API Endpoints

### Get All News Articles

```
GET /api/cricket/news
```

### Get Article by ID

```
GET /api/cricket/news/:id
```

### Query Parameters

| Parameter | Type   | Description                                        | Example                            |
| --------- | ------ | -------------------------------------------------- | ---------------------------------- |
| `limit`   | number | Max articles to return (default: 10, max: 50)      | `?limit=10`                        |
| `offset`  | number | Skip articles for pagination                       | `?offset=20`                       |
| `source`  | string | Filter by source: `cricbuzz`, `espn`, `icc`, `all` | `?source=icc`                      |
| `search`  | string | Search in title/description/content                | `?search=ashes`                    |
| `tag`     | string | Filter by tag                                      | `?tag=ICC World Test Championship` |
| `sort`    | string | Sort order: `newest` (default) or `oldest`         | `?sort=oldest`                     |

---

## 2. Response Schema

### Article Object

```typescript
interface NewsArticle {
  // Identifiers
  id: string; // Unique ID (cuid format)
  slug: string; // URL-friendly slug
  sourceId: string; // Source-specific ID (e.g., "icc-article-slug")

  // Content
  title: string; // Article headline
  description: string; // Short summary (max 500 chars)
  content: string; // Full article content (MARKDOWN FORMAT)

  // Images
  imageUrl: string | null; // Main image (high-res)
  thumbnailUrl: string | null; // Thumbnail image

  // Metadata
  sport: string; // Always "cricket"
  category: string | null; // e.g., "ICC World Test Championship", "News"
  sourceName: string; // "Cricbuzz" | "ESPN Cricinfo" | "ICC Cricket"
  sourceUrl: string; // Original article URL

  // SEO
  metaTitle: string | null;
  metaDesc: string | null;
  tags: string[]; // Array of tags

  // Related Content
  relatedArticles: RelatedArticle[] | null;

  // Embedded Tweets (ICC Cricket only)
  embeddedTweets: string[]; // Array of Twitter/X tweet IDs

  // Timestamps
  publishedTime: string | null; // ISO 8601 format
  scrapedAt: string; // When article was scraped
  createdAt: string; // When saved to DB
  updatedAt: string; // Last update time
}

interface RelatedArticle {
  title: string;
  link: string;
}
```

---

## 3. Content Formatting

### ⚠️ IMPORTANT: Content Format Varies by Source

The `content` field format depends on the news source. Use `react-markdown` for all sources - it handles both plain text and markdown correctly.

### Content Features by Source (Verified Dec 23, 2025)

| Source            | Bold          | Headings     | Links            | Content Quality                           |
| ----------------- | ------------- | ------------ | ---------------- | ----------------------------------------- |
| **ICC Cricket**   | ✅ `**text**` | ✅ `#`, `##` | ✅ `[text](url)` | **Rich markdown** (avg 36 bold, 10 links) |
| **ESPN Cricinfo** | ❌ Plain text | ❌           | ❌               | **Plain text** from JSON-LD               |
| **Cricbuzz**      | ❌ Plain text | ❌           | ❌               | **Plain text**                            |

> **Why ESPN/Cricbuzz are plain text:** These sources use JSON-LD structured data for content, which strips HTML formatting. ICC embeds rich HTML in their article pages.

### Sample ICC Content (Markdown - Rich Formatting)

```markdown
# ICC World Test Championship 2025-27: State of Play

The [ICC World Test Championship](https://www.icc-cricket.com/...) cycle has entered a crucial period.

Defending champions South Africa have made a leap following a [historic 2-0 series sweep](https://www.icc-cricket.com/news/...).

### 1. Australia

**Played:** Six
**Wins:** Six  
**Points Percentage:** 100

**Leading run-scorer this cycle:** Travis Head (603 runs)
**Leading wicket-taker this cycle:** Mitchell Starc (37 wickets)
```

### Sample ESPN/Cricbuzz Content (Plain Text)

```text
Rob Key has pledged to investigate England players' conduct during their mid-Ashes break in Noosa and described drinking heavily as "completely unacceptable" for an international cricket team.

England travelled to Noosa, the affluent resort town on the Queensland coast, after their eight-wicket defeat...
```

---

## 4. React Implementation

### Required Package

```bash
npm install react-markdown
```

### Basic Usage

```jsx
import ReactMarkdown from "react-markdown";

function ArticlePage({ article }) {
  return (
    <article>
      <h1>{article.title}</h1>
      <p className="meta">
        {article.sourceName} • {formatDate(article.publishedTime)}
      </p>

      {article.imageUrl && <img src={article.imageUrl} alt={article.title} />}

      {/* Render markdown content */}
      <div className="article-body">
        <ReactMarkdown>{article.content}</ReactMarkdown>
      </div>

      {/* Tags */}
      <div className="tags">
        {article.tags?.map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}
```

### With Custom Styling

```jsx
import ReactMarkdown from "react-markdown";

function ArticleContent({ content }) {
  return (
    <ReactMarkdown
      components={{
        // Custom heading styles
        h1: ({ node, ...props }) => (
          <h1 className="text-3xl font-bold mb-4" {...props} />
        ),
        h2: ({ node, ...props }) => (
          <h2 className="text-2xl font-semibold mt-6 mb-3" {...props} />
        ),
        h3: ({ node, ...props }) => (
          <h3 className="text-xl font-semibold mt-4 mb-2" {...props} />
        ),

        // Paragraphs
        p: ({ node, ...props }) => (
          <p className="mb-4 leading-relaxed" {...props} />
        ),

        // Bold text (stats)
        strong: ({ node, ...props }) => (
          <strong className="font-bold text-blue-600" {...props} />
        ),

        // Links
        a: ({ node, href, ...props }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
            {...props}
          />
        ),

        // Lists
        ul: ({ node, ...props }) => (
          <ul className="list-disc list-inside mb-4" {...props} />
        ),
        ol: ({ node, ...props }) => (
          <ol className="list-decimal list-inside mb-4" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

### Next.js with Tailwind

```jsx
// components/ArticleBody.tsx
import ReactMarkdown from "react-markdown";

export function ArticleBody({ content }: { content: string }) {
  return (
    <div className="prose prose-lg max-w-none dark:prose-invert">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
```

> **Tip:** Using Tailwind's `prose` class from `@tailwindcss/typography` gives you beautiful article styling with zero configuration.

---

## 5. Handling Images

### Image Fields

| Field          | Size     | Use Case            |
| -------------- | -------- | ------------------- |
| `imageUrl`     | High-res | Article detail page |
| `thumbnailUrl` | Smaller  | Article cards/lists |

### Next.js Image Optimization

```jsx
import Image from "next/image";

function ArticleCard({ article }) {
  return (
    <div className="card">
      {article.thumbnailUrl ? (
        <Image
          src={article.thumbnailUrl}
          alt={article.title}
          width={400}
          height={225}
          className="rounded-lg"
        />
      ) : (
        <div className="placeholder-image">No image</div>
      )}
      <h2>{article.title}</h2>
    </div>
  );
}
```

### Image Domains to Whitelist (next.config.js)

```js
module.exports = {
  images: {
    domains: [
      "images.icc-cricket.com",
      "img1.hscicdn.com", // ESPN Cricinfo
      "static.cricbuzz.com",
      "www.cricbuzz.com",
    ],
  },
};
```

---

## 6. Date Handling

### publishedTime Format

The `publishedTime` field is an ISO 8601 string:

```
"2025-12-22T22:25:00.000Z"
```

### Formatting Examples

```js
// Option 1: Native JavaScript
function formatDate(isoString) {
  if (!isoString) return "Unknown date";
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
// Output: "December 22, 2025"

// Option 2: Relative time (e.g., "5 hours ago")
function timeAgo(isoString) {
  if (!isoString) return "";
  const seconds = Math.floor(
    (Date.now() - new Date(isoString).getTime()) / 1000
  );

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return formatDate(isoString);
}
```

---

## 7. SEO Implementation

### Head Tags

```jsx
import Head from "next/head";

function ArticlePage({ article }) {
  return (
    <>
      <Head>
        <title>{article.metaTitle || article.title}</title>
        <meta
          name="description"
          content={article.metaDesc || article.description}
        />

        {/* Open Graph */}
        <meta property="og:title" content={article.title} />
        <meta property="og:description" content={article.description} />
        <meta property="og:image" content={article.imageUrl} />
        <meta property="og:type" content="article" />
        <meta
          property="article:published_time"
          content={article.publishedTime}
        />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={article.title} />
        <meta name="twitter:image" content={article.imageUrl} />

        {/* Article tags */}
        {article.tags?.map((tag) => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}
      </Head>
      {/* ... */}
    </>
  );
}
```

---

## 8. Filtering by Source

### Source Names

| Source        | `sourceName` Value |
| ------------- | ------------------ |
| Cricbuzz      | `"Cricbuzz"`       |
| ESPN Cricinfo | `"ESPN Cricinfo"`  |
| ICC Cricket   | `"ICC Cricket"`    |

### Filter Component

```jsx
function SourceFilter({ selected, onChange }) {
  const sources = ["All", "Cricbuzz", "ESPN Cricinfo", "ICC Cricket"];

  return (
    <div className="flex gap-2">
      {sources.map((source) => (
        <button
          key={source}
          onClick={() => onChange(source === "All" ? null : source)}
          className={selected === source ? "active" : ""}
        >
          {source}
        </button>
      ))}
    </div>
  );
}
```

---

## 9. Error Handling

### Handle Missing Fields

```jsx
function ArticleCard({ article }) {
  return (
    <div className="card">
      <img
        src={article.thumbnailUrl || article.imageUrl || "/placeholder.jpg"}
        alt={article.title}
        onError={(e) => (e.target.src = "/placeholder.jpg")}
      />
      <h2>{article.title}</h2>
      <p>{article.description || "No description available"}</p>
      <span>{article.category || "General"}</span>
    </div>
  );
}
```

---

## 10. Rendering Embedded Tweets (ICC Cricket)

ICC Cricket articles may contain embedded tweets. The `embeddedTweets` field contains an array of tweet IDs.

### Install Package

```bash
npm install react-twitter-embed
```

### Basic Usage

```jsx
import { TwitterTweetEmbed } from "react-twitter-embed";

function ArticleWithTweets({ article }) {
  return (
    <article>
      <ReactMarkdown>{article.content}</ReactMarkdown>

      {/* Render embedded tweets */}
      {article.embeddedTweets?.length > 0 && (
        <div className="embedded-tweets mt-8">
          <h3 className="text-lg font-semibold mb-4">Related Tweets</h3>
          {article.embeddedTweets.map((tweetId) => (
            <div key={tweetId} className="mb-4">
              <TwitterTweetEmbed tweetId={tweetId} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
```

### With Loading Placeholder

```jsx
import { TwitterTweetEmbed } from "react-twitter-embed";

function TweetEmbed({ tweetId }) {
  return (
    <TwitterTweetEmbed
      tweetId={tweetId}
      placeholder={
        <div className="animate-pulse bg-gray-200 rounded-lg h-48 flex items-center justify-center">
          Loading tweet...
        </div>
      }
      options={{ theme: "dark" }} // or 'light'
    />
  );
}
```

### Sample Data

```json
{
  "title": "Ashes secured in Adelaide as Australia boost WTC27 hopes",
  "embeddedTweets": [
    "2002586142227734739",
    "2002602030289023024",
    "2002579464199233798"
  ]
}
```

> **Note:** Only ICC Cricket articles have embedded tweets. ESPN and Cricbuzz articles will have an empty array.

---

## 11. Performance Tips

1. **Use `thumbnailUrl` for lists** - Faster loading for article cards
2. **Lazy load images** - Use `loading="lazy"` or Next.js Image
3. **Cache API responses** - 5-minute cache for news lists
4. **Paginate results** - Use `?limit=10&offset=0`
5. **Prefetch article pages** - Use Next.js `prefetch`

---

## 12. Complete Example

```jsx
// pages/news/[slug].tsx
import { GetServerSideProps } from "next";
import ReactMarkdown from "react-markdown";
import Head from "next/head";

interface Article {
  title: string;
  content: string;
  description: string;
  imageUrl: string;
  sourceName: string;
  publishedTime: string;
  tags: string[];
}

export default function ArticlePage({ article }: { article: Article }) {
  return (
    <>
      <Head>
        <title>{article.title} | Cricket News</title>
        <meta name="description" content={article.description} />
        <meta property="og:image" content={article.imageUrl} />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <article>
          <header className="mb-8">
            <h1 className="text-4xl font-bold mb-4">{article.title}</h1>
            <div className="text-gray-600">
              {article.sourceName} •{" "}
              {new Date(article.publishedTime).toLocaleDateString()}
            </div>
          </header>

          {article.imageUrl && (
            <img
              src={article.imageUrl}
              alt={article.title}
              className="w-full rounded-xl mb-8"
            />
          )}

          <div className="prose prose-lg max-w-none">
            <ReactMarkdown>{article.content}</ReactMarkdown>
          </div>

          <footer className="mt-8 pt-4 border-t">
            <div className="flex gap-2">
              {article.tags?.map((tag) => (
                <span
                  key={tag}
                  className="bg-gray-100 px-3 py-1 rounded-full text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </footer>
        </article>
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const res = await fetch(
    `${process.env.API_URL}/api/cricket/news/${params?.slug}`
  );
  const article = await res.json();

  return { props: { article } };
};
```

---

## Summary

| Field             | Type     | Note                                                        |
| ----------------- | -------- | ----------------------------------------------------------- |
| `content`         | String   | Use `react-markdown` (works for both plain text & markdown) |
| `imageUrl`        | URL      | High-res, use for detail page                               |
| `thumbnailUrl`    | URL      | Low-res, use for cards                                      |
| `publishedTime`   | ISO 8601 | Format with `toLocaleDateString()`                          |
| `tags`            | string[] | Array of tag strings (may be empty)                         |
| `relatedArticles` | JSON     | Array of `{title, link}` objects (may be empty)             |
| `author`          | string   | ESPN has author, ICC/Cricbuzz may not                       |
| `keywords`        | string[] | ESPN provides keywords                                      |

### Key Takeaways:

1. **Always use `react-markdown`** - It renders both plain text and markdown correctly
2. **ICC Cricket has rich content** - Bold stats, headings, clickable links
3. **ESPN/Cricbuzz have plain text** - Quality content but no formatting
4. **Handle missing fields** - `author`, `tags`, `relatedArticles` may be null/empty

### Data Quality by Source:

| Source            | Content               | Metadata | Author     | Tags                          |
| ----------------- | --------------------- | -------- | ---------- | ----------------------------- |
| **ICC Cricket**   | ✅ Rich (1300+ words) | ✅ Full  | ⚠️ Missing | ⚠️ Empty                      |
| **ESPN Cricinfo** | ✅ Good (1000+ words) | ✅ Full  | ✅ Yes     | ⚠️ Empty (keywords available) |
| **Cricbuzz**      | ✅ Good               | ✅ Full  | ⚠️ Missing | ⚠️ Empty                      |
