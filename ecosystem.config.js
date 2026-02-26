module.exports = {
  apps: [
    {
      name: 'api-manager',
      script: 'server.js',
      cwd: '/home/ubuntu/apps/api-manager',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      node_args: '--max-old-space-size=512'
    },
    {
      name: 'live-score-worker',
      script: 'scrapers/live-score-worker.js',
      cwd: '/home/ubuntu/apps/api-manager',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      node_args: '--max-old-space-size=320',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'tweet-worker',
      script: 'scrapers/tweet-worker.js',
      cwd: '/home/ubuntu/apps/api-manager',
      instances: 1,
      autorestart: false, // Don't restart - runs once per cron
      watch: false,
      // Peak engagement hours for Indian cricket fans (IST = UTC+5:30)
      // 8:30 AM IST (03:00 UTC) - Morning commute
      // 12:30 PM IST (07:00 UTC) - Lunch break
      // 6:30 PM IST (13:00 UTC) - After work/school
      // 9:30 PM IST (16:00 UTC) - Prime time evening
      cron_restart: '0 3,7,13,16 * * *', // 8:30AM, 12:30PM, 6:30PM, 9:30PM IST
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'news-scraper',
      script: 'scripts/vps-scrape.sh',
      cwd: '/home/ubuntu/apps/api-manager',
      interpreter: 'bash',
      instances: 1,
      autorestart: false,
      watch: false,
      // Run at 35 minutes past the hour (Offset for safety)
      // IST: 6:05AM, 8:05AM, 10:05AM, 12:05PM, 2:05PM, 4:05PM, 6:05PM, 8:05PM, 10:05PM, 12:05AM
      cron_restart: '35 0,2,4,6,8,10,12,14,16,18 * * *',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'recent-score-worker',
      script: 'scrapers/recent-score-worker.js',
      cwd: '/home/ubuntu/apps/api-manager',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      node_args: '--max-old-space-size=192',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
