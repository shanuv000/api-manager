/**
 * Cricbuzz Photos Scraper
 * 
 * Direct Cheerio-based scraping from Cricbuzz photo galleries.
 * Replaces RapidAPI dependency for photos, saving API quota.
 * 
 * Data Sources:
 * - Gallery List: https://www.cricbuzz.com/cricket-photo-gallery
 * - Gallery Detail: https://www.cricbuzz.com/cricket-gallery/:id/:slug
 * - Images: https://static.cricbuzz.com/a/img/v1/{size}/i1/c{imageId}/{slug}.jpg
 */

const axios = require("axios");
const cheerio = require("cheerio");
const { withAxiosRetry } = require("../utils/scraper-retry");

// Base URLs
const BASE_URL = "https://www.cricbuzz.com";
const GALLERY_LIST_URL = `${BASE_URL}/cricket-photo-gallery`;
const STATIC_CDN_URL = "https://static.cricbuzz.com";

// Image size options for frontend flexibility
const IMAGE_SIZES = {
    thumbnail: "300x170",  // List view thumbnails
    medium: "540x303",     // Card view
    large: "650x0",        // Detail view (height auto)
    original: "i1",        // Original size
};

// User agent for requests
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Parse JSON-LD scripts from HTML
 * @param {CheerioStatic} $ - Cheerio instance
 * @returns {Array} Array of parsed JSON-LD objects
 */
function parseJsonLd($) {
    const jsonLdData = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const data = JSON.parse($(el).html());
            jsonLdData.push(data);
        } catch (e) {
            // Skip invalid JSON
        }
    });
    return jsonLdData;
}

/**
 * Extract image ID from Cricbuzz image URL
 * @param {string} url - Image URL
 * @returns {string|null} Image ID or null
 */
function extractImageId(url) {
    if (!url) return null;
    const match = url.match(/\/c(\d+)\//);
    return match ? match[1] : null;
}

/**
 * Generate image URLs in multiple sizes for frontend flexibility
 * @param {string} imageId - The image ID
 * @param {string} slug - Image slug/filename
 * @returns {object} Object with URLs for different sizes
 */
function generateImageUrls(imageId, slug = "i") {
    if (!imageId) return null;

    const baseImagePath = `/a/img/v1`;
    return {
        thumbnail: `${STATIC_CDN_URL}${baseImagePath}/${IMAGE_SIZES.thumbnail}/i1/c${imageId}/${slug}.jpg`,
        medium: `${STATIC_CDN_URL}${baseImagePath}/${IMAGE_SIZES.medium}/i1/c${imageId}/${slug}.jpg`,
        large: `${STATIC_CDN_URL}${baseImagePath}/${IMAGE_SIZES.large}/i1/c${imageId}/${slug}.jpg`,
        original: `${STATIC_CDN_URL}${baseImagePath}/${IMAGE_SIZES.original}/c${imageId}/${slug}.jpg`,
        // Proxy URL through our API to avoid CORS issues
        proxy: `/api/cricket/photos/image/i1/c${imageId}/${slug}.jpg`,
    };
}

/**
 * Fetch the list of photo galleries
 * @returns {Promise<object>} Gallery list with metadata
 */
async function fetchPhotoGalleryList() {
    const response = await withAxiosRetry(
        () => axios.get(GALLERY_LIST_URL, {
            headers: { "User-Agent": USER_AGENT },
            timeout: 15000,
        }),
        { operationName: "Photo Gallery List", maxRetries: 3 }
    );

    const $ = cheerio.load(response.data);
    const jsonLdData = parseJsonLd($);

    // Extract ImageGallery entries from JSON-LD
    const imageGalleries = jsonLdData.filter(d => d["@type"] === "ImageGallery");

    // Build gallery list from both JSON-LD and DOM for completeness
    const galleries = [];
    const seenIds = new Set();

    // Method 1: Parse gallery links from DOM (most reliable for hrefs)
    $('a[href^="/cricket-gallery/"]').each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href");

        // Extract gallery ID from href: /cricket-gallery/6066/india-vs-new-zealand...
        const match = href.match(/\/cricket-gallery\/(\d+)\/([^/]+)/);
        if (!match || seenIds.has(match[1])) return;

        const galleryId = match[1];
        const slug = match[2];
        seenIds.add(galleryId);

        // Find corresponding JSON-LD data
        const jsonLdMatch = imageGalleries.find(g =>
            g.name && slug.includes(g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30))
        );

        // Extract data from DOM
        const $divs = $el.find("div").filter((_, d) =>
            $(d).children().length === 0 && $(d).text().trim().length > 0
        );

        const title = $divs.eq(0).text().trim() || jsonLdMatch?.name || slug.replace(/-/g, " ");
        const dateText = $divs.eq(1).text().trim();

        // Get image from the anchor
        const img = $el.find("img");
        const imageUrl = img.attr("src") || img.attr("data-src");
        const imageId = extractImageId(imageUrl);

        galleries.push({
            galleryId,
            slug,
            headline: title,
            url: `${BASE_URL}${href}`,
            publishedDate: dateText || null,
            publishedTime: jsonLdMatch?.datePublished || null,
            coverImage: imageId ? {
                imageId,
                urls: generateImageUrls(imageId, slug),
                alt: title,
            } : null,
        });
    });

    // If DOM parsing yielded no results, fall back to pure JSON-LD
    if (galleries.length === 0 && imageGalleries.length > 0) {
        imageGalleries.forEach((g, index) => {
            const imageUrl = g.image?.url || g.image;
            const imageId = extractImageId(imageUrl);

            galleries.push({
                galleryId: String(6070 - index), // Approximate ID
                slug: g.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `gallery-${index}`,
                headline: g.name || g.headline,
                url: null,
                publishedDate: null,
                publishedTime: g.datePublished,
                coverImage: imageId ? {
                    imageId,
                    urls: generateImageUrls(imageId),
                    alt: g.name || g.headline,
                } : null,
            });
        });
    }

    return {
        success: true,
        count: galleries.length,
        galleries,
        source: "cricbuzz-scrape",
        timestamp: new Date().toISOString(),
    };
}

/**
 * Fetch a specific photo gallery's details
 * @param {string} galleryId - Gallery ID
 * @param {string} [slug] - Optional slug for URL (improves caching if unknown)
 * @returns {Promise<object>} Gallery details with all photos
 */
async function fetchPhotoGalleryById(galleryId, slug = null) {
    if (!galleryId) {
        throw new Error("Gallery ID is required");
    }

    // If we don't have slug, we need to find it from gallery list or make a preliminary request
    let galleryUrl;
    if (slug) {
        galleryUrl = `${BASE_URL}/cricket-gallery/${galleryId}/${slug}`;
    } else {
        // Try to fetch the gallery directly - Cricbuzz redirects to proper URL
        galleryUrl = `${BASE_URL}/cricket-gallery/${galleryId}`;
    }

    const response = await withAxiosRetry(
        () => axios.get(galleryUrl, {
            headers: { "User-Agent": USER_AGENT },
            timeout: 15000,
            maxRedirects: 5,
        }),
        { operationName: `Photo Gallery ${galleryId}`, maxRetries: 3 }
    );

    const $ = cheerio.load(response.data);
    const jsonLdData = parseJsonLd($);

    // Extract ImageObject entries (individual photos)
    const imageObjects = jsonLdData.filter(d => d["@type"] === "ImageObject");

    // Extract gallery metadata from the page
    const headline = imageObjects[0]?.headline ||
        $("h1").first().text().trim() ||
        $('meta[property="og:title"]').attr("content") ||
        "Photo Gallery";

    // Build photos array from JSON-LD ImageObjects
    const photos = imageObjects.map((img, index) => {
        const imageUrl = img.image;
        const imageId = extractImageId(imageUrl);
        const slugFromUrl = imageUrl?.match(/\/c\d+\/([^.]+)\.jpg/)?.[1] || "i";

        return {
            index: index + 1,
            imageId,
            caption: img.caption || null,
            headline: img.headline,
            datePublished: img.datePublished,
            dimensions: {
                width: img.width || null,
                height: img.height || null,
            },
            urls: generateImageUrls(imageId, slugFromUrl),
            originalUrl: imageUrl,
        };
    });

    // If JSON-LD didn't provide images, fall back to DOM scraping
    if (photos.length === 0) {
        $('img[src*="/i1/c"]').each((index, el) => {
            const $img = $(el);
            const imageUrl = $img.attr("src");
            const imageId = extractImageId(imageUrl);
            const alt = $img.attr("alt") || null;

            if (imageId) {
                photos.push({
                    index: index + 1,
                    imageId,
                    caption: alt,
                    headline: headline,
                    datePublished: null,
                    dimensions: { width: null, height: null },
                    urls: generateImageUrls(imageId),
                    originalUrl: imageUrl,
                });
            }
        });
    }

    // Extract tags/categories if available
    const tags = [];
    $('a[href*="/cricket-series/"], a[href*="/profiles/"]').each((_, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr("href");
        if (text && href) {
            tags.push({
                name: text,
                type: href.includes("profiles") ? "player" : "series",
                url: `${BASE_URL}${href}`,
            });
        }
    });

    // Get final URL (after redirects)
    const finalUrl = response.request?.res?.responseUrl || galleryUrl;

    return {
        success: true,
        galleryId,
        headline,
        url: finalUrl,
        photoCount: photos.length,
        photos,
        tags: tags.slice(0, 10), // Limit tags
        source: "cricbuzz-scrape",
        timestamp: new Date().toISOString(),
    };
}

/**
 * Fetch an image from Cricbuzz CDN
 * @param {string} imagePath - Image path (e.g., "i1/c829459/i.jpg")
 * @returns {Promise<object>} Image data buffer and content type
 */
async function fetchImage(imagePath) {
    if (!imagePath) {
        throw new Error("Image path is required");
    }

    // Clean and validate path
    const cleanPath = imagePath.replace(/^\/+/, "");

    // Validate path format for security
    if (!/^[a-zA-Z0-9\/._-]+$/.test(cleanPath)) {
        throw new Error("Invalid image path format");
    }

    // Construct the full CDN URL
    const imageUrl = `${STATIC_CDN_URL}/a/img/v1/${cleanPath}`;

    const response = await axios.get(imageUrl, {
        headers: {
            "User-Agent": USER_AGENT,
            "Referer": BASE_URL,
        },
        responseType: "arraybuffer",
        timeout: 30000,
    });

    return {
        data: response.data,
        contentType: response.headers["content-type"] || "image/jpeg",
        size: response.data.length,
    };
}

/**
 * Get image URL for a specific size
 * @param {string} imageId - Image ID
 * @param {string} size - Size key: thumbnail, medium, large, original
 * @param {string} slug - Optional slug
 * @returns {string} Direct CDN URL
 */
function getImageUrl(imageId, size = "large", slug = "i") {
    if (!imageId) return null;
    const sizeValue = IMAGE_SIZES[size] || IMAGE_SIZES.large;
    return `${STATIC_CDN_URL}/a/img/v1/${sizeValue}/i1/c${imageId}/${slug}.jpg`;
}

module.exports = {
    fetchPhotoGalleryList,
    fetchPhotoGalleryById,
    fetchImage,
    getImageUrl,
    generateImageUrls,
    extractImageId,
    IMAGE_SIZES,
    BASE_URL,
    STATIC_CDN_URL,
};
