module.exports = {
  apps: [
    {
      name: "scholarmark-mcp",
      script: "server.mjs",
      cwd: "/opt/app/mcp-server",
      interpreter: "/usr/bin/node",
      env: {
        MCP_SERVER_PORT: "5002",
        SCHOLARMARK_BACKEND_URL: "http://127.0.0.1:5001",
        MCP_AUTHORIZATION_SERVER: "https://app.scholarmark.ai",
        MCP_RESOURCE_URL: "https://mcp.scholarmark.ai",
      },
    },
  ],
};
