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
  // uuid, archiver 8 (and its zip-stream / compress-commons / minimatch
  // closure) and @fastify/cookie's `cookie` dependency are ESM-only, and jest's
  // CJS runtime cannot require them. Transforming them through swc rewrites the
  // import/export statements into require() calls.
  transformIgnorePatterns: [
    "/node_modules/(?!(uuid|@fastify/cookie|cookie|archiver|zip-stream|compress-commons|crc32-stream|is-stream|minimatch|brace-expansion|balanced-match)/)",
  ],
  coverageProvider: "v8",
  testMatch: ["/**/src/**/*.spec.(ts|js)"],
  testEnvironment: "node",
};
