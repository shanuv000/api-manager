require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

(async () => {
  const slug =
    "stats-virat-kohli-and-rohit-sharma-s-vijay-hazare-trophy-comeback-and-the-list-a-odi-disconnect-1517446";
  const article = await prisma.newsArticle.findFirst({
    where: { slug },
    select: { content: true },
  });

  if (!article) {
    console.log("Article NOT found");
    return;
  }

  const content = article.content;
  console.log("--- CONTENT SAMPLE START ---");
  console.log(content.substring(0, 1500));
  console.log("--- CONTENT SAMPLE END ---\n");

  // Verify Table 1
  const table1Index = content.indexOf("### Table 1");
  const table1Content = content.substring(table1Index, table1Index + 500);
  console.log("Table 1 Position:", table1Index);
  console.log("Table 1 Sample:\n", table1Content);

  // Verify Text AROUND Table 1
  const textBeforeTable1 = content.substring(table1Index - 200, table1Index);
  const textAfterTable1 = content.substring(
    content.indexOf("---", table1Index) + 4,
    content.indexOf("---", table1Index) + 200
  );
  console.log(
    "\nText BEFORE Table 1:\n",
    "..." + textBeforeTable1.replace(/\n/g, " ")
  );
  console.log(
    "Text AFTER Table 1:\n",
    textAfterTable1.replace(/\n/g, " ") + "..."
  );

  // Verify Reference
  const refIndex = content.indexOf("refer to Table 1 above");
  console.log("\nReference Index:", refIndex);
  console.log("Is Table 1 BEFORE Reference?", table1Index < refIndex);

  await prisma.$disconnect();
  await pool.end();
})();
