module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/electron/renderer', '<rootDir>/../tests/frontend'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  moduleNameMapper: {
    '\\.svg$': '<rootDir>/test-mocks/fileMock.cjs',
  },
};
