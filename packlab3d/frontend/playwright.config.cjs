module.exports = {
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../tests/e2e/logs/e2e_report.json' }]],
  use: {
    // packlab3d/tests/e2e/artifacts/ holds screenshots per the Stage 9 spec.
    // Playwright appends test-name subfolders under this automatically for
    // trace/video; explicit screenshots are taken with their own paths in the spec.
  },
};
