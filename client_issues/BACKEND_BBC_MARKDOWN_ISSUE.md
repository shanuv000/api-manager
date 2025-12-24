# Backend Report: Malformed Markdown in BBC Sport Articles

**Report Date:** December 24, 2025  
**Priority:** Medium  
**Status:** ✅ FIXED (Backend - December 24, 2025)

---

## Issue Summary

BBC Sport articles have **two content quality issues**:

1. **Malformed bold markdown** - Spaces before closing `**` markers break rendering
2. **Metadata in content** - Published date and comment count are being included in the article body

The frontend has implemented preprocessing workarounds, but ideally the content should be cleaned at the scraping/API level.

---

## Problem Details

### Issue 1: Malformed Bold Markdown

The BBC Sport scraper is producing bold markers with **trailing spaces before the closing `**`\*\*:

```markdown
❌ INCORRECT (current output):
**Ben Duckett – 2 – **Arrived with a reputation...

✅ CORRECT (expected):
**Ben Duckett – 2 –**Arrived with a reputation...
```

#### Why It Breaks Rendering

Standard CommonMark/GFM markdown specification requires:

- **No whitespace** between content and closing `**`
- Pattern `**text**` is valid
- Pattern `**text **` is **invalid** (space before closing)

When the parser encounters `**text – **`, it doesn't recognize it as bold because of the trailing space.

---

### Issue 2: Metadata Mixed into Main Content

The BBC Sport scraper is including **article metadata** (published date, comment count) directly in the `content` field instead of using separate metadata fields:

```markdown
❌ INCORRECT (current output in content field):
Published21 December 2025
886 Comments\*\*Ben Stokes said he "absolutely" wants to remain England captain...

✅ CORRECT (expected):

- publishedTime: "2025-12-21T00:00:00.000Z"
- commentCount: 886 (or omit if not needed)
- content: "\*\*Ben Stokes said he \"absolutely\" wants to remain England captain..."
```

#### Problems This Causes

1. **Duplicate date display** - Date shows in content AND in our publishedTime display
2. **Unparseable format** - "Published21 December 2025" has no space between "Published" and date
3. **Comment count in content** - "886 Comments" is not useful in article body
4. **Bold marker attached** - The `**` starts immediately after "Comments" with no newline

#### Suggested Fix

Strip the metadata prefix from content during scraping:

```python
# Python example
import re

def clean_bbc_content(content: str) -> str:
    # Remove "Published{date}\n{count} Comments" prefix
    content = re.sub(
        r'^Published\d{1,2}\s+\w+\s+\d{4}\s*\n?\d+\s+Comments',
        '',
        content,
        flags=re.MULTILINE
    )
    return content.strip()
```

---

## Sample Data

**Article URL:** https://play.urtechy.com/news/cp34p04dzd3o

**Raw Content (problematic):**

```markdown
'It's frustrating' - Smith out for 60 after poor shot

**Ben Duckett – 2 – **Arrived with a reputation as one of the best openers...

**Zak Crawley – 6 – **Showed admirable fight and adaptability...

**Ollie Pope – 2 – **Test career over for now?

Joe Root – 4 – Two starts, without making a telling contribution.
```

**Issues Found:**
| Line | Issue |
|------|-------|
| `**Ben Duckett – 2 – **` | Space before closing `**` |
| `**Zak Crawley – 6 – **` | Space before closing `**` |
| `**Ollie Pope – 2 – **` | Space before closing `**` |
| `Joe Root – 4 –` | Missing bold markers entirely |

---

## Frontend Workaround

We've added a `preprocessContent()` function in `ArticleContent.tsx` that fixes these issues before rendering:

```typescript
const preprocessContent = (rawContent: string): string => {
  let processed = rawContent;

  // Fix: "**text – **" → "**text –**" (remove space before closing **)
  processed = processed.replace(/\s+\*\*(?=\s|$|[^*])/g, "**");

  // Fix: "** text" → "**text" (remove space after opening **)
  processed = processed.replace(/\*\*\s+(?=[^\s*])/g, "**");

  // Fix: Empty bold "****" → remove
  processed = processed.replace(/\*{4,}/g, "");

  // Fix: Unmatched trailing ** at end of line
  processed = processed.replace(/\*\*\s*$/gm, "");

  return processed;
};
```

---

## Recommended Backend Fix

### Option 1: Fix at Scraping Level (Preferred)

When extracting content from BBC Sport articles, clean the markdown:

```python
# Python example
import re

def clean_markdown(content: str) -> str:
    # Remove space before closing **
    content = re.sub(r'\s+\*\*(?=\s|$|[^*])', '**', content)
    # Remove space after opening **
    content = re.sub(r'\*\*\s+(?=[^\s*])', '**', content)
    return content
```

### Option 2: Fix in API Response

Add a content sanitization step before returning articles:

```javascript
// Node.js example
function sanitizeMarkdown(content) {
  return content
    .replace(/\s+\*\*(?=\s|$|[^*])/g, "**")
    .replace(/\*\*\s+(?=[^\s*])/g, "**");
}
```

---

## Impact Assessment

| Aspect              | Current State                                  |
| ------------------- | ---------------------------------------------- |
| **Affected Source** | BBC Sport only                                 |
| **Other Sources**   | ICC Cricket, ESPN, Cricbuzz are fine           |
| **User Impact**     | Bold text not rendering for player names/stats |
| **SEO Impact**      | Minor - content still readable                 |
| **Frontend Fix**    | ✅ Applied (workaround)                        |

---

## Action Items

### Issue 1: Malformed Bold

- [x] **Backend Team:** Investigate BBC Sport scraper markdown output
- [x] **Backend Team:** Add markdown sanitization at scraper or API level

### Issue 2: Metadata in Content

- [x] **Backend Team:** Strip "Published{date}" and "{count} Comments" from content field
- [x] **Backend Team:** Ensure `publishedTime` field is populated from this data

### Frontend

- [ ] **Frontend Team:** Remove `preprocessContent()` once backend fixes are deployed (optional - can keep as safety net)

---

## Related Files

- **Frontend Fix:** `src/components/news/ArticleContent.tsx`
- **API Guide:** `issues/FRONTEND_BLOG_GUIDE.md`
- **Commit:** `7925df7` - "fix(ArticleContent): preprocess malformed bold markdown from BBC Sport"

---

## Contact

Report created by: Frontend Team  
Date: December 24, 2025
