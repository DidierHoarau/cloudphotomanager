module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx|js)$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.spec.json",
        tsconfigRaw: {
          compilerOptions: {
            allowJs: true,
          },
        },
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!uuid)"],
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
  maxWorkers: 2,
  workerIdleMemoryLimit: "512MB",
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/Analysis*.ts",
    "!src/**/SyncFileCache.ts",
    "!src/**/SyncInventory.ts",
    "!src/**/SyncQueue.ts",
    "!src/**/AwsS3*.ts",
    "!src/**/OneDrive*.ts",
    "!src/**/GoogleDrive*.ts",
    "!src/App.ts",
    "!src/Config.ts",
    "!src/OTelContext.ts",
    "!src/SystemCommand.ts",
  ],
};
