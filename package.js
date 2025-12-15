Package.describe({
  name: "anonyfox:synced-cron",
  version: "0.0.1",
  summary: "Synchronized cron jobs across multiple Meteor 3.3+ instances",
  git: "https://github.com/Anonyfox/synced-cron",
  documentation: "README.md",
});

Package.onUse((api) => {
  api.versionsFrom(["3.3"]);

  api.use("ecmascript");
  api.use("typescript");
  api.use("mongo");

  api.mainModule("src/index.ts", "server");
});

Package.onTest((api) => {
  api.use("ecmascript");
  api.use("typescript");
  api.use("meteortesting:mocha");
  api.use("mongo");
  api.use("anonyfox:synced-cron");

  // Colocated tests - import all test files from src/
  api.mainModule("src/tests.ts", "server");
});
