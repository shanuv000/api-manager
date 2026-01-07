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
    }
  ]
};
