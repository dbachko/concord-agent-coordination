import "dotenv/config";
import { resolve } from "node:path";
import express from "express";
import { createServer as createHttpServer } from "node:http";
import { createApp } from "./app.js";
import { Store } from "./store.js";

const port = Number(process.env.PORT || 4317);
const stateFile =
  process.env.STATE_FILE ||
  (port === 4317
    ? ".data/state-gpu-watch.json"
    : `.data/state-gpu-watch-${port}.json`);
const { app, close } = createApp({ store: new Store(resolve(stateFile)) });
const server = createHttpServer(app);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, ws: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
server.listen(port, "127.0.0.1", () =>
  console.log(`Concord local demo: http://127.0.0.1:${port}`),
);
process.on("SIGTERM", () => {
  close();
  server.close();
});
process.on("SIGINT", () => {
  close();
  server.close();
  process.exit(0);
});
