# AI Enhancer Current Workflow Documentation

## 1. System Overview

The **Content Enhancer** is a specialized Node.js service that enriches raw scraped cricket articles using the **Claude Opus** AI model. It operates as a post-processing layer in the existing content pipeline.

**Core Philosophy:** Drop-in compatibility. The system upgrades content quality (SEO, readability, metadata) without altering the existing database schema, API contracts, or frontend rendering logic.

**Architecture strategy:**
- **Dual-Pass Processing:** Uses two distinct AI passes (Enhancement + Formatting) to ensure high intelligence and strict structural compliance.
- **Queue-less Design:** Fetches unprocessed records directly from the database in batches.
- **Stateless:** Does not maintain internal state between runs; relies on database persistence.

## 2. Data Flow

1.  **Ingestion (Prisma):**
    *   The script queries `NewsArticle` items where `content` is not null and `enhancedContent` is null.
    *   Batch Size: 1 (Strict sequential processing for Opus stability).

2.  **Pass 1: Intelligence (Claude Opus):**
    *   **Input:** Raw ID, Title, Body, Source, Date.
    *   **Prompt:** `system_prompt_enhancer.md`
    *   **Action:** generates new titles, SEO metadata, sentiment analysis, and rewrites the article body in Markdown.
    *   **Output:** JSON Array containing the enhanced data object.

3.  **Pass 2: Structure & Hygiene (Claude Opus):**
    *   **Input:** Result from Pass 1.
    *   **Prompt:** `system_prompt_formatter.md`
    *   **Action:** Flattens nested arrays, enforces Markdown header hierarchy (H2 start), validates JSON types.
    *   **Output:** Strictly valid, flat JSON array `[{ ... }]`.

4.  **Persistence (Prisma):**
    *   Upserts the result into the `EnhancedContent` table.
    *   Status set to `"published"`.

5.  **Cache Invalidation:**
    *   Clears Redis keys for the specific article slug and the main news list to ensure immediate visibility on the frontend.

## 3. Input Schema

The system accepts a raw article object from Prisma:

```javascript
{
  "id": "String (UUID)",
  "title": "String",
  "content": "String (Raw HTML or Text)",
  "publishedTime": "Date Object",
  "sourceUrl": "String"
}
```

## 4. Output Schema

The system produces a strictly validated JSON structure. This schema is **IMMUTABLE** to prevent frontend regressions.

```json
[
  {
    "original_title": "String",
    "enhanced_data": {
      "enhanced_title": "String (SEO Optimized)",
      "seo_meta_description": "String (140-160 chars)",
      "slug_suggestion": "String (kebab-case)",
      "full_blog_post_markdown": "String (Markdown Content)",
      "tags": ["String", "String"],
      "sentiment": "positive | neutral | negative",
      "virality_score": Integer (1-10)
    }
  }
]
```

## 5. Markdown Rendering Rules

The `full_blog_post_markdown` field adheres to strict semantic rules to integrate seamlessly with the frontend application.

*   **Header Hierarchy:**
    *   **Starts with H2 (`##`)**: The Frontend application renders the `enhanced_title` as the page's `<h1>`. Therefore, the content body must start at `##` to maintain accessible and semantic HTML structure.
    *   **Subsections (`###`)**: Used for grouping distinct topics within the article.
*   **Spacing:** Double newlines (`\n\n`) are preserved to ensure distinct paragraphs.
*   **Quotes:** Standard Markdown blockquotes (`>`) are used.
*   **Safety:** No raw HTML (`<div>`, `<script>`) is permitted.

## 6. SEO & Content Rules

*   **Enhanced Title:** Must be action-oriented and include key entities (Teams, Players).
*   **Meta Description:** Optimized for Google SERP (Search Engine Results Page). Limits: 140-160 characters.
*   **Tags:** Array of 6-10 keywords mixing broad categories (e.g., "T20 World Cup") and specific entities (e.g., "Mitchell Marsh").
*   **Virality Score:** Restricted to **1-10** integer. Used for sorting "Trending" sections.
    *   Logic: Score represents match importance + emotional impact + star power.

## 7. Validation Rules

The pipeline enforces the following constraints before saving:

1.  **JSON Structure:** Must be a flat array key `[...]`.
2.  **Types:** `virality_score` must be integer. `tags` must be array of strings.
3.  **Content:** `full_blog_post_markdown` must be non-empty string.
4.  **Headers:** Markdown must not contain `# ` (H1).

## 8. Backward Compatibility Guarantees

*   **Schema Stability:** The `enhanced_data` object structure mirrors the legacy enhancer's output exactly.
*   **Frontend Agnosticism:** The frontend is unaware that the backend provider switched from Perplexity/ChatGPT to Claude Opus. It simply renders the JSON/Markdown delivered by the API.
*   **Database:** No migration was required. The `EnhancedContent` table schema remains unchanged.

## 9. Current Failure Handling

*   **API Errors:** Caught and logged to `console.error`. The script proceeds to the next article.
*   **Parsing Errors:** If Claude returns invalid JSON (e.g., truncated text), the item is skipped with a "Parse failed" log.
*   **No Retry Logic (Current):** Failed items are left as `enhancedContent: null` and will be picked up again in the next run (unless a retry limit mechanism implies otherwise, but currently the script just fetches `null` items).
*   *Note: This basic failure handling is the target for future improvements (Fallbacks).*

## 10. Summary

The current enhancer is a robust, clean-loop system ensuring high-quality output through a rigorous two-step AI process. By adhering to strict strict input/output contracts, it safely replaces legacy components while significantly upgrading content intelligence.
