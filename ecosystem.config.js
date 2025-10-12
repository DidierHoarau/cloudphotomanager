const fs = require("fs");
let devEnv = {};
if (fs.existsSync("./env-dev.js")) {
  devEnv = require("./env-dev");
}

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
      autorestart: true,
      env_development: {
        DEV_MODE: "true",
        TMP_DIR: "../docs/dev/data/tmp",
        CONFIG_FILE: "../config.json",
        TOOLS_DIR: "../cloudphotomanager-tools",
        DATA_DIR: "../docs/dev/data",
        ...devEnv,
        AUTO_SYNC: "Y",
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
