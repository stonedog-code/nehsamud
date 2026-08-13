/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Strip the ESM ".js" suffix TypeScript emits, and resolve the "@/" alias
    // the app uses.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { useESM: true, tsconfig: { jsx: "react-jsx", module: "esnext" } },
    ],
  },
  collectCoverageFrom: ["src/lib/**/*.ts"],
};
