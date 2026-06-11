module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || "standalone-blog-writer",
      cwd: process.env.APP_DIR || "/opt/standalone-blog-writer",
      script: "dist/index.cjs",
      interpreter: "/usr/bin/node",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "5001",
        DATABASE_PATH: process.env.DATABASE_PATH || "data/standalone-blog-writer.db",
      },
      max_memory_restart: "750M",
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
      listen_timeout: 10000,
      merge_logs: true,
    },
  ],
};
