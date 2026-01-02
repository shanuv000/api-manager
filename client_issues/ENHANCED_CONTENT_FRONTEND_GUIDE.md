# Enhanced Content - Frontend Integration Guide

## API Response Changes

### `/api/cricket/news` (List)

```json
{
  "data": [
    {
      "id": "...",
      "slug": "article-slug",
      "title": "Original Title",
      "displayTitle": "SEO Enhanced Title",  // NEW - use this
      "hasEnhancedContent": true,             // NEW
      "description": "...",
      ...
    }
  ]
}
```

### `/api/cricket/news/:slug` (Single Article)

```json
{
  "data": {
    "id": "...",
    "title": "Original Title",
    "content": "Original content",

    // NEW FIELDS - Use these for display:
    "hasEnhancedContent": true,
    "displayTitle": "SEO Enhanced Title",
    "displayContent": "### Markdown content with **bold** and > quotes",
    "displayMetaDescription": "SEO meta description for <meta> tag",
    "keyTakeaways": ["Key point 1", "Key point 2", "Key point 3"],

    // Full enhanced object (optional):
    "enhancedContent": {
      "id": "...",
      "title": "...",
      "content": "...",
      "metaDescription": "...",
      "keyTakeaways": [...]
    }
  }
}
```

---

## Frontend Implementation

### Article List Component

```jsx
// Use displayTitle for better SEO titles
<ArticleCard
  title={article.displayTitle}
  hasEnhanced={article.hasEnhancedContent}
/>;

// Optional: Show badge for enhanced articles
{
  article.hasEnhancedContent && <Badge>✨ Enhanced</Badge>;
}
```

### Single Article Page

```jsx
import ReactMarkdown from "react-markdown";

function ArticlePage({ article }) {
  return (
    <>
      {/* SEO Meta Tags */}
      <Head>
        <title>{article.displayTitle}</title>
        <meta name="description" content={article.displayMetaDescription} />
      </Head>

      {/* Article Content */}
      <h1>{article.displayTitle}</h1>

      {/* Key Takeaways (optional) */}
      {article.keyTakeaways?.length > 0 && (
        <div className="key-takeaways">
          <h3>Key Takeaways</h3>
          <ul>
            {article.keyTakeaways.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Main Content - Rendered as Markdown */}
      <ReactMarkdown>{article.displayContent}</ReactMarkdown>
    </>
  );
}
```

---

## Markdown Elements to Support

The enhanced content includes these markdown elements:

| Element  | Example                 | Rendering Needed |
| -------- | ----------------------- | ---------------- |
| Headings | `### Section Title`     | `<h3>`           |
| Bold     | `**Virat Kohli**`       | `<strong>`       |
| Quotes   | `> 'Player quote here'` | `<blockquote>`   |
| Lists    | `- Point 1`             | `<ul><li>`       |
| Tables   | `\| Player \| Runs \|`  | `<table>`        |

**Recommended Library:** `react-markdown` with `remark-gfm` plugin for tables.

```bash
npm install react-markdown remark-gfm
```

```jsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

<ReactMarkdown remarkPlugins={[remarkGfm]}>
  {article.displayContent}
</ReactMarkdown>;
```

---

## Fallback Behavior

If `hasEnhancedContent` is `false`, the fields still work:

```jsx
// These always have values (enhanced or original)
article.displayTitle; // Enhanced or original title
article.displayContent; // Enhanced or original content
article.keyTakeaways; // Empty array [] if not enhanced
```

No conditional logic needed - just use `displayTitle` and `displayContent` always.
