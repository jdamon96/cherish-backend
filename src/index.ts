import { app, env } from "./app";

const PORT = parseInt(env.PORT || "3000", 10);

// Start the server
const server = app.listen(PORT, () => {
  console.log(`🚀 Cherish Backend API running on port ${PORT}`);
  console.log(`📊 Environment: ${env.NODE_ENV}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 API Routes:`);
  console.log(`   Person Facts:`);
  console.log(`     POST /api/insert-person-fact`);
  console.log(`   Gift Parsing:`);
  console.log(`     POST /api/parse-gift-image`);
  console.log(`   Gift Recommendations (Legacy):`);
  console.log(`     POST /api/get-gift-recs`);
  console.log(`   General Gift Ideas:`);
  console.log(`     POST /api/general-gift-ideas/generate`);
  console.log(`     GET  /api/general-gift-ideas (includes feedback)`);
  console.log(`     POST /api/general-gift-ideas/refresh`);
  console.log(`     PUT  /api/general-gift-ideas/:id/dismiss`);
  console.log(`     POST /api/general-gift-ideas/:id/feedback`);
  console.log(`     POST /api/general-gift-ideas/:id/refine`);
  console.log(`   Specific Gift Ideas:`);
  console.log(`     POST /api/specific-gift-ideas/generate`);
  console.log(
    `     GET  /api/specific-gift-ideas (includes interaction status)`
  );
  console.log(`     POST /api/specific-gift-ideas/save`);
  console.log(`     POST /api/specific-gift-ideas/pass`);
  console.log(`     GET  /api/specific-gift-ideas/saved`);
  console.log(`   Product Search:`);
  console.log(`     POST /api/product/search`);
  console.log(`     POST /api/product/metadata`);
  console.log(`     POST /api/product/lookup`);
  console.log(`     POST /api/product/screenshot`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});
