/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Workspace dependency. Jest's resolver doesn't honor the
    // package.json `exports` field reliably for ESM packages, so
    // point bare imports of @nehsamud/engine-db at the built dist file
    // directly. The package is workspace-symlinked into root
    // node_modules, but the resolution falls through without this
    // mapper.
    "^@nehsamud/engine-db$": "<rootDir>/../engine-db/dist/index.js",
  },
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "NodeNext",
          esModuleInterop: true,
          strict: true,
        },
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/**/__tests__/**", "!src/index.ts"],
};
