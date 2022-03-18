/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  modulePathIgnorePatterns: ["mitmproxy"],
  // https://github.com/facebook/jest/issues/7962#issuecomment-495272339
  coveragePathIgnorePatterns: ["discord.ts"],
};