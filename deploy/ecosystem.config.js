module.exports = {
  apps: [
    {
      name: "sourceannotator",
      cwd: "/opt/app",
      script: "dist/index.cjs",
      interpreter: "/usr/bin/node",
      env: {
        NODE_ENV: "production",
        PORT: "5001",
      },
      max_memory_restart: "750M",
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
      listen_timeout: 10000,
      merge_logs: true,
    },
  ],
};
