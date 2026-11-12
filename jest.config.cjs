/** @type {import('jest').Config} */
module.exports = {
  testPathIgnorePatterns: [
    "/node_modules/",
    // Shared test helpers live beside the tests but are not suites.
    "/__tests__/helpers/",
  ],
};
