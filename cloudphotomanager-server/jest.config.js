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
};
