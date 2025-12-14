# Cricket News Auto-Fetch Setup

## Overview
Automated cron job to fetch and store cricket news articles every 6 hours using GitHub Actions.

## Schedule
- **Frequency:** Every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)
- **Manual Trigger:** Available via GitHub Actions UI

## How It Works

1. **GitHub Actions** triggers the workflow on schedule
2. **API Endpoint** `/api/cricket/news?limit=20` is called
3. **Scraper** fetches latest 20 news articles from Cricbuzz
4. **Database** stores articles with duplicate prevention (upsert by `cricbuzzId`)
5. **Result** logged in GitHub Actions summary

## Duplicate Prevention

✅ **Already implemented** via upsert logic:
```javascript
await prisma.newsArticle.upsert({
  where: { cricbuzzId: article.id },  // Unique constraint
  update: { /* update fields */ },
  create: { /* create new */ }
});
```

**Unique fields preventing duplicates:**
- `cricbuzzId` - Unique constraint in database
- `cricbuzzUrl` - Unique constraint in database  
- `slug` - Unique constraint in database

## Setup Instructions

### 1. Deploy Your API
First, make sure your API is deployed (e.g., on Vercel):
```bash
vercel --prod
```

### 2. Update Workflow File
Edit `.github/workflows/fetch-cricket-news.yml`:
```yaml
# Replace this URL with your actual deployed API URL
curl -s "https://your-actual-api.vercel.app/api/cricket/news?limit=20"
```

### 3. Push to GitHub
```bash
git add .github/workflows/fetch-cricket-news.yml
git commit -m "Add automated cricket news fetching"
git push origin main
```

### 4. Verify in GitHub
1. Go to your repo on GitHub
2. Click **Actions** tab
3. See "Fetch Cricket News" workflow
4. Click **Run workflow** to test manually

## Manual Trigger

You can manually trigger the workflow anytime:

1. Go to **GitHub** → **Your Repo** → **Actions**
2. Select **"Fetch Cricket News"** workflow
3. Click **"Run workflow"** dropdown
4. Click **"Run workflow"** button

## Monitoring

View workflow runs:
- **GitHub Actions tab** shows all runs
- **Green checkmark** = Success
- **Red X** = Failed (check logs)

Each run shows:
- Number of articles fetched
- Source (database vs scraped)
- Article titles

## Schedule Explanation

```yaml
cron: '0 */6 * * *'
```

Breakdown:
- `0` - At minute 0
- `*/6` - Every 6 hours
- `*` - Every day
- `*` - Every month
- `*` - Every day of week

**Runs at:** 00:00, 06:00, 12:00, 18:00 UTC daily

## Benefits

✅ **Automatic Updates** - No manual intervention needed
✅ **Fresh Content** - Always up-to-date cricket news
✅ **SEO Growth** - Continuous content addition
✅ **No Duplicates** - Built-in deduplication
✅ **Free** - GitHub Actions provides 2,000 minutes/month free

## Customization

### Change Frequency

**Every 12 hours:**
```yaml
cron: '0 */12 * * *'
```

**Every 3 hours:**
```yaml
cron: '0 */3 * * *'
```

**Daily at midnight:**
```yaml
cron: '0 0 * * *'
```

### Change Article Limit

Modify the URL parameter:
```bash
# Fetch 30 articles instead of 20
/api/cricket/news?limit=30
```

## Troubleshooting

### Workflow Not Running
- Check if GitHub Actions is enabled in repo settings
- Verify cron syntax is correct
- Check if default branch is `main` or `master`

### API Errors
- Verify API URL is correct and deployed
- Check API logs in Vercel dashboard
- Test endpoint manually: `curl https://your-api.com/api/cricket/news?limit=1`

### Database Issues
- Check Supabase connection
- Verify DATABASE_URL is set in Vercel environment variables
- Check Prisma schema is migrated

## Cost Estimate

**GitHub Actions:**
- Free tier: 2,000 minutes/month
- This workflow: ~2 minutes per run
- 4 runs/day × 30 days = 120 runs/month
- **Total:** ~240 minutes/month (well within free tier)

**API/Scraping:**
- Vercel Hobby: 100GB bandwidth free
- Supabase Free: 500MB database free
- Should handle thousands of articles easily

## Next Steps

After setup:
1. ✅ Monitor first few runs in GitHub Actions
2. ✅ Verify articles appear in database
3. ✅ Check no duplicates are created
4. ✅ Adjust frequency if needed
5. ✅ Add error notifications (optional)

## Optional: Add Notifications

To get notified on failures, add this step to the workflow:

```yaml
- name: Notify on Failure
  if: failure()
  uses: actions/github-script@v6
  with:
    script: |
      github.rest.issues.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: '🚨 Cricket News Fetch Failed',
        body: 'The automated cricket news fetch workflow failed. Check the logs.'
      })
```
