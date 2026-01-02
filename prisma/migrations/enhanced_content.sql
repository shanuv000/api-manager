-- Create enhanced_content table for SEO-optimized content
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS "enhanced_content" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "keyTakeaways" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enhanced_content_pkey" PRIMARY KEY ("id")
);

-- Create unique index on articleId (one-to-one relationship)
CREATE UNIQUE INDEX IF NOT EXISTS "enhanced_content_articleId_key" ON "enhanced_content"("articleId");

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS "enhanced_content_articleId_idx" ON "enhanced_content"("articleId");
CREATE INDEX IF NOT EXISTS "enhanced_content_createdAt_idx" ON "enhanced_content"("createdAt" DESC);

-- Add foreign key constraint
ALTER TABLE "enhanced_content" 
ADD CONSTRAINT "enhanced_content_articleId_fkey" 
FOREIGN KEY ("articleId") 
REFERENCES "news_articles"("id") 
ON DELETE CASCADE ON UPDATE CASCADE;
