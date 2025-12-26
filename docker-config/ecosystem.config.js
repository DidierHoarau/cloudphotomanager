module.exports = {
  apps: [
    {
      name: "proxy",
      script: "nginx",
      args: ["-g", "daemon off;"],
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "server",
      script: "dist/App.js",
      node_args: "--max-old-space-size=8192",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
