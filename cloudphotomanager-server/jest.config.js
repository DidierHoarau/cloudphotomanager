module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx|js)$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2022",
        },
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!uuid)"],
  coverageProvider: "v8",
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
};
