import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const app: Express = express();

app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex");
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
const sitePages: Record<string, string> = { "/": "index.html", "/commands": "commands.html", "/changelog": "changelog.html", "/status": "status.html", "/404": "404.html" };
app.get(Object.keys(sitePages), (req, res) => {
  const file = sitePages[req.path] ?? "404.html";
  const siteUrl = (process.env.SITE_URL ?? "https://dea-5e46.onrender.com").replace(/\/$/, "");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(readFileSync(path.join(webDir, file), "utf8").replaceAll("__SITE_URL__", siteUrl));
});
app.use(express.static(webDir, { extensions: ["html"], index: "index.html" }));
app.get("/health", (_req, res) => res.redirect(302, "/status"));
app.get("*splat", (req, res) => {
  const siteUrl = (process.env.SITE_URL ?? "https://dea-5e46.onrender.com").replace(/\/$/, "");
  res.status(404).type("html").send(readFileSync(path.join(webDir, "404.html"), "utf8").replaceAll("__SITE_URL__", siteUrl));
});

export default app;
