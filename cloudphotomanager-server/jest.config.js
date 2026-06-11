module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.spec.json",
      },
    ],
    "^.+\\.js$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!uuid)"],
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
};
