module.exports = {
  apps: [
    {
      name: 'api-manager',
      script: 'server.js',
      cwd: '/home/dev/app/api-manager',
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
      cwd: '/home/dev/app/api-manager',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'tweet-worker',
      script: 'scrapers/tweet-worker.js',
      cwd: '/home/dev/app/api-manager',
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
    }
  ]
};
