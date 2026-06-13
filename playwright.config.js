const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4187",
    viewport: { width: 375, height: 667 },
    channel: "chrome",
  },
  webServer: {
    command: "PORT=4187 node serve.js",
    port: 4187,
    reuseExistingServer: true,
  },
});
