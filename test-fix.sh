#!/bin/bash

# Truncate the news_articles table in Supabase
export PGPASSWORD="shanu9334187630"

psql "postgresql://postgres:shanu9334187630@db.khsxxjzbhkuguotuogon.supabase.co:5432/postgres" -c "TRUNCATE TABLE news_articles;"

echo "✅ Table truncated. Now scraping fresh data..."

# Trigger fresh scrape
curl -s 'http://localhost:5003/api/cricket/news?limit=3' | python3 -c "import sys, json; data = json.load(sys.stdin); print('\n🎉 Fresh data scraped!'); [print(f\"\n{i+1}. {article['title']}\nDescription: {article['description'][:200]}...\") for i, article in enumerate(data['data'])]"
