module.exports = {
  apps: [
    {
      name: "cloudphotomanager-proxy",
      cwd: "cloudphotomanager-proxy",
      script: "npm",
      args: "run start",
      autorestart: false,
      ignore_watch: ["node_modules"],
    },
    {
      name: "cloudphotomanager-server",
      cwd: "cloudphotomanager-server",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        DEV_MODE: "true",
        TMP_DIR: "../docs/dev/tmp",
        DATA_DIR: "../docs/dev/data",
        OPENTELEMETRY_COLLECTOR_HTTP: "http://localhost:4318/v1/traces",
        OPENTELEMETRY_COLLECTOR_AWS: true,
        AUTO_SYNC: "N",
      },
    },
    {
      name: "cloudphotomanager-web",
      cwd: "cloudphotomanager-web",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        DEV_MODE: "true",
      },
    },
  ],
};
