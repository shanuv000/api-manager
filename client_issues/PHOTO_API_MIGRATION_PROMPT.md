# Frontend Migration: Photo Gallery API Changes

## Task
Update the frontend code to work with the new Photo Gallery API response structure. The backend has been migrated from RapidAPI to direct Cheerio scraping, resulting in a cleaner but different data structure.

## API Base URL
```
https://drop.urtechy.com/api/cricket
```

---

## Endpoint 1: `/photos/list` - Gallery List

### OLD Response Structure (deprecated):
```json
{
  "success": true,
  "data": {
    "photoGalleryInfoList": [
      {
        "photoGalleryInfo": {
          "galleryId": 6066,
          "headline": "India vs New Zealand, 3rd ODI, Indore",
          "imageId": 829459,
          "publishedTime": "1764782490515",
          "imageHash": "..."
        }
      }
    ]
  }
}
```

### NEW Response Structure:
```json
{
  "success": true,
  "count": 9,
  "data": [
    {
      "galleryId": "6066",
      "slug": "india-vs-new-zealand-3rd-odi-indore",
      "headline": "India vs New Zealand, 3rd ODI, Indore",
      "url": "https://www.cricbuzz.com/cricket-gallery/6066/...",
      "publishedDate": "Sun, Jan 18, 2026",
      "publishedTime": "2026-01-18T12:16:11.862Z",
      "coverImage": {
        "imageId": "829459",
        "urls": {
          "thumbnail": "https://static.cricbuzz.com/.../300x170/...",
          "medium": "https://static.cricbuzz.com/.../540x303/...",
          "large": "https://static.cricbuzz.com/.../650x0/...",
          "original": "https://static.cricbuzz.com/.../i1/...",
          "proxy": "/api/cricket/photos/image/i1/c829459/..."
        },
        "alt": "India vs New Zealand, 3rd ODI, Indore"
      }
    }
  ],
  "source": "cricbuzz-scrape",
  "timestamp": "2026-01-22T05:01:07.076Z"
}
```

### Migration Changes Required:
1. `data` is now a **flat array**, not `data.photoGalleryInfoList`
2. Remove `.photoGalleryInfo` nesting
3. `galleryId` is now a **string** (was number)
4. Use `coverImage.urls.thumbnail` instead of constructing URL from `imageId`
5. Use `publishedTime` (ISO format) instead of unix timestamp
6. **NEW**: Use `coverImage.urls.proxy` for CORS-safe image loading

---

## Endpoint 2: `/photos/gallery/:galleryId` - Gallery Details

### OLD Response Structure (deprecated):
```json
{
  "success": true,
  "data": {
    "photoGalleryDetails": [
      {
        "imageId": 829459,
        "caption": "...",
        "imageHash": "..."
      }
    ],
    "tags": [...],
    "headline": "..."
  }
}
```

### NEW Response Structure:
```json
{
  "success": true,
  "data": {
    "galleryId": "6066",
    "headline": "India vs New Zealand, 3rd ODI, Indore",
    "url": "https://www.cricbuzz.com/cricket-gallery/6066/...",
    "photoCount": 6,
    "photos": [
      {
        "index": 1,
        "imageId": "829459",
        "caption": "Henry Nicholls was dismissed early for a duck.",
        "headline": "India vs New Zealand, 3rd ODI, Indore",
        "datePublished": "2026-01-18T12:16:11.862Z",
        "dimensions": {
          "width": 540,
          "height": 303
        },
        "urls": {
          "thumbnail": "https://static.cricbuzz.com/.../300x170/...",
          "medium": "https://static.cricbuzz.com/.../540x303/...",
          "large": "https://static.cricbuzz.com/.../650x0/...",
          "original": "https://static.cricbuzz.com/.../i1/...",
          "proxy": "/api/cricket/photos/image/i1/c829459/..."
        },
        "originalUrl": "https://static.cricbuzz.com/..."
      }
    ],
    "tags": [...]
  }
}
```

### Migration Changes Required:
1. Use `data.photos` instead of `data.photoGalleryDetails`
2. Each photo now has full `urls` object with multiple sizes
3. **NEW**: `dimensions` object with `width` and `height`
4. **NEW**: `index` property for ordering
5. Use `urls.proxy` for CORS-safe image loading in frontend

---

## Image Loading Best Practices

### For list view (thumbnails):
```jsx
<img 
  src={gallery.coverImage.urls.thumbnail} 
  alt={gallery.headline} 
/>
```

### For gallery view (high-res):
```jsx
// Option 1: Direct CDN (faster, but may have CORS issues)
<img src={photo.urls.large} alt={photo.caption} />

// Option 2: Proxy (CORS-safe, recommended)
<img 
  src={`https://drop.urtechy.com${photo.urls.proxy}`} 
  alt={photo.caption} 
/>
```

### For lightbox/modal (original size):
```jsx
<img src={photo.urls.original} alt={photo.caption} />
```

---

## Summary of Breaking Changes
| Change | Old | New |
|--------|-----|-----|
| Gallery list access | `data.photoGalleryInfoList[].photoGalleryInfo` | `data[]` |
| Gallery ID type | `number` | `string` |
| Image URL | Construct from imageId | Use `coverImage.urls.thumbnail` |
| Photos array | `data.photoGalleryDetails` | `data.photos` |
| Published time | Unix timestamp string | ISO 8601 format |
| Image dimensions | Not available | `dimensions.width/height` |

---

## Test URLs
- Gallery List: https://drop.urtechy.com/api/cricket/photos/list
- Gallery Detail: https://drop.urtechy.com/api/cricket/photos/gallery/6066
- Image Proxy: https://drop.urtechy.com/api/cricket/photos/image/i1/c829459/i.jpg
