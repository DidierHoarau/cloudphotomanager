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
  // uuid is ESM-only, and @fastify/cookie loads its `cookie` dependency with
  // a native dynamic import(); the `cookie` package itself ships ESM syntax
  // that jest's CJS runtime cannot require. Transforming them through swc
  // rewrites both to require() calls.
  transformIgnorePatterns: ["/node_modules/(?!(uuid|@fastify/cookie|cookie)/)"],
  coverageProvider: "v8",
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
};
