/**
 * Test Script: Enhanced Content Extraction with Tables
 *
 * Tests different approaches for extracting tables from ICC articles
 * to find the best format for frontend rendering.
 *
 * Run: node scrapers/test-table-extraction.js
 */

const puppeteer = require("puppeteer-core");

// Test article with standings table
const TEST_URL =
  "https://www.icc-cricket.com/news/icc-world-test-championship-2025-27-where-do-teams-stand";

async function testTableExtraction() {
  console.log("\n🧪 Testing Table Extraction for ICC Articles\n");
  console.log("━".repeat(70));

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "/snap/bin/chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
  );

  console.log(`\n📄 Testing URL: ${TEST_URL}\n`);

  await page.goto(TEST_URL, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await new Promise((r) => setTimeout(r, 3000));

  // Extract content with multiple approaches
  const results = await page.evaluate(() => {
    const output = {
      approach1_paragraphsOnly: [],
      approach2_markdownWithTables: [],
      approach3_htmlPreserved: [],
      approach4_structuredJson: [],
    };

    // ========== APPROACH 1: Current (Paragraphs Only) ==========
    document.querySelectorAll("article p, main p").forEach((p) => {
      const text = p.textContent.trim();
      if (text && text.length > 40) {
        output.approach1_paragraphsOnly.push(text);
      }
    });

    // ========== APPROACH 2: Markdown with Tables ==========
    const contentArea = document.querySelector(
      "article, main, [class*='content']"
    );
    if (contentArea) {
      const elements = contentArea.querySelectorAll(
        "p, h2, h3, h4, table, ul, ol"
      );

      elements.forEach((el) => {
        if (el.tagName === "P") {
          const text = el.textContent.trim();
          if (text && text.length > 30) {
            output.approach2_markdownWithTables.push(text);
          }
        } else if (el.tagName.match(/^H[2-4]$/)) {
          const text = el.textContent.trim();
          if (text) {
            const level = parseInt(el.tagName[1]);
            output.approach2_markdownWithTables.push(
              "#".repeat(level) + " " + text
            );
          }
        } else if (el.tagName === "TABLE") {
          // Convert table to markdown
          const rows = el.querySelectorAll("tr");
          const tableLines = [];

          rows.forEach((row, rowIndex) => {
            const cells = row.querySelectorAll("th, td");
            const cellTexts = Array.from(cells).map((c) =>
              c.textContent.trim()
            );
            tableLines.push("| " + cellTexts.join(" | ") + " |");

            // Add header separator after first row
            if (rowIndex === 0) {
              tableLines.push(
                "| " + cellTexts.map(() => "---").join(" | ") + " |"
              );
            }
          });

          if (tableLines.length > 0) {
            output.approach2_markdownWithTables.push(
              "\n" + tableLines.join("\n") + "\n"
            );
          }
        } else if (el.tagName === "UL" || el.tagName === "OL") {
          const items = el.querySelectorAll("li");
          items.forEach((li, i) => {
            const prefix = el.tagName === "OL" ? `${i + 1}.` : "-";
            output.approach2_markdownWithTables.push(
              `${prefix} ${li.textContent.trim()}`
            );
          });
        }
      });
    }

    // ========== APPROACH 3: Preserve HTML for Tables ==========
    if (contentArea) {
      const elements = contentArea.querySelectorAll("p, h2, h3, h4, table");

      elements.forEach((el) => {
        if (el.tagName === "TABLE") {
          // Keep table as HTML
          output.approach3_htmlPreserved.push({
            type: "table",
            html: el.outerHTML,
          });
        } else {
          const text = el.textContent.trim();
          if (text && text.length > 30) {
            output.approach3_htmlPreserved.push({
              type: el.tagName.toLowerCase(),
              text: text,
            });
          }
        }
      });
    }

    // ========== APPROACH 4: Structured JSON ==========
    const tables = document.querySelectorAll("article table, main table");
    tables.forEach((table) => {
      const rows = table.querySelectorAll("tr");
      const tableData = {
        type: "table",
        headers: [],
        rows: [],
      };

      rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll("th, td");
        const cellTexts = Array.from(cells).map((c) => c.textContent.trim());

        if (rowIndex === 0) {
          tableData.headers = cellTexts;
        } else {
          tableData.rows.push(cellTexts);
        }
      });

      if (tableData.headers.length > 0 || tableData.rows.length > 0) {
        output.approach4_structuredJson.push(tableData);
      }
    });

    return output;
  });

  await browser.close();

  // ========== DISPLAY RESULTS ==========

  console.log("\n" + "═".repeat(70));
  console.log("📋 APPROACH 1: Paragraphs Only (Current)");
  console.log("═".repeat(70));
  console.log(`Content pieces: ${results.approach1_paragraphsOnly.length}`);
  console.log(
    "\nSample:\n" + results.approach1_paragraphsOnly.slice(0, 3).join("\n\n")
  );
  console.log("\n⚠️  Tables: NOT CAPTURED");

  console.log("\n" + "═".repeat(70));
  console.log("📋 APPROACH 2: Markdown with Tables (RECOMMENDED)");
  console.log("═".repeat(70));
  console.log(`Content pieces: ${results.approach2_markdownWithTables.length}`);
  console.log("\nFull content:\n");
  console.log(results.approach2_markdownWithTables.join("\n\n"));
  console.log("\n✅ Tables: CAPTURED AS MARKDOWN");

  console.log("\n" + "═".repeat(70));
  console.log(
    "📋 APPROACH 3: HTML Preserved (for React dangerouslySetInnerHTML)"
  );
  console.log("═".repeat(70));
  const tableCount = results.approach3_htmlPreserved.filter(
    (x) => x.type === "table"
  ).length;
  console.log(
    `Content pieces: ${results.approach3_htmlPreserved.length}, Tables: ${tableCount}`
  );
  console.log("\nSample table HTML:");
  const tableHtml = results.approach3_htmlPreserved.find(
    (x) => x.type === "table"
  );
  if (tableHtml) {
    console.log(tableHtml.html.substring(0, 500) + "...");
  }
  console.log("\n✅ Tables: CAPTURED AS HTML");

  console.log("\n" + "═".repeat(70));
  console.log("📋 APPROACH 4: Structured JSON (for custom frontend rendering)");
  console.log("═".repeat(70));
  console.log(`Tables found: ${results.approach4_structuredJson.length}`);
  if (results.approach4_structuredJson.length > 0) {
    console.log("\nTable data:");
    console.log(JSON.stringify(results.approach4_structuredJson[0], null, 2));
  }
  console.log("\n✅ Tables: CAPTURED AS JSON STRUCTURE");

  console.log("\n" + "═".repeat(70));
  console.log("📊 RECOMMENDATION FOR FRONTEND");
  console.log("═".repeat(70));
  console.log(`
  APPROACH 2 (Markdown) is BEST for most frontends because:
  
  ✅ Works with react-markdown, marked.js, etc.
  ✅ Tables render automatically with markdown parsers
  ✅ Headings are preserved with proper hierarchy
  ✅ Lists (bulleted/numbered) are preserved
  ✅ Easy to style with CSS
  ✅ Single 'content' field in database
  
  Example React usage:
  
  import ReactMarkdown from 'react-markdown';
  
  <ReactMarkdown>{article.content}</ReactMarkdown>
  `);
}

testTableExtraction().catch(console.error);
