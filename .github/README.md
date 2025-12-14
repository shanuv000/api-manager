# GitHub Actions Workflows

This directory contains automated workflows for maintaining the Cricket API.

## 🔥 Cache Warming (`warm-cache.yml`)

**Purpose:** Keep Redis cache fresh by pre-warming it before users request data

**Schedule:**
- Runs every 30 minutes
- Can be triggered manually via GitHub Actions UI

**What it does:**
1. Calls `/api/cricket/recent-scores` (warms 1-hour cache)
2. Calls `/api/cricket/live-scores` (warms 1-minute cache)
3. Calls `/api/cricket/upcoming-matches` (warms 3-hour cache)

**Benefits:**
- Users always get fast responses (<0.1s from cache)
- Prevents Vercel timeout issues on cold starts
- Ensures fresh data availability

---

## 🏥 Health Check (`health-check.yml`)

**Purpose:** Monitor API availability and endpoint health

**Schedule:**
- Runs every 6 hours
- Can be triggered manually via GitHub Actions UI

**What it does:**
1. Tests all three cricket endpoints
2. Verifies HTTP 200 response
3. Fails workflow if any endpoint is down

**Benefits:**
- Early detection of API issues
- Automatic monitoring (no manual checks needed)
- GitHub will notify you on failures

---

## 📝 Setup Instructions

### 1. Configure Your Vercel Domain

Add your Vercel domain as a GitHub secret:

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `VERCEL_DOMAIN`
5. Value: `your-api-name.vercel.app` (without https://)
6. Click **Add secret**

### 2. Enable GitHub Actions

GitHub Actions should be enabled by default. If not:

1. Go to **Settings** → **Actions** → **General**
2. Enable **Allow all actions and reusable workflows**
3. Save

### 3. Manual Trigger (Optional)

To manually run a workflow:

1. Go to **Actions** tab in GitHub
2. Select the workflow (Warm Cricket Cache or API Health Check)
3. Click **Run workflow**
4. Select branch and click **Run workflow**

---

## 📊 Monitoring

### View Workflow Runs

1. Go to **Actions** tab
2. See all workflow executions
3. Click on any run to see details

### Workflow Status Badges (Optional)

Add to your README.md:

```markdown
![Cache Warming](https://github.com/YOUR_USERNAME/YOUR_REPO/actions/workflows/warm-cache.yml/badge.svg)
![Health Check](https://github.com/YOUR_USERNAME/YOUR_REPO/actions/workflows/health-check.yml/badge.svg)
```

---

## 🎯 Cache Duration Strategy

| Endpoint | Cache TTL | Warm Frequency | Rationale |
|----------|-----------|----------------|-----------|
| Live Scores | 1 minute | Every 30 min | Frequently changing data |
| Recent Scores | 1 hour | Every 30 min | Balance freshness & load |
| Upcoming Matches | 3 hours | Every 2 hours | Stable fixture data |

---

## 💡 Tips

- **GitHub Actions is free** for public repos (2,000 minutes/month for private)
- Workflows run on GitHub servers (doesn't count against Vercel limits)
- Failed health checks will send you email notifications
- Cache warming prevents users from hitting slow cold starts

---

## 🔧 Troubleshooting

### Workflow fails with 404
- Check `VERCEL_DOMAIN` secret is set correctly
- Verify your Vercel deployment is live

### Workflow not running
- Check GitHub Actions is enabled in Settings
- Verify cron syntax is correct

### Need to disable a workflow?
- Go to `.github/workflows/`
- Delete or rename the `.yml` file
- Or disable it in GitHub Actions UI
