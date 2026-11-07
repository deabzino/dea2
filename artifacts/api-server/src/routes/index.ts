import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { getPublicBotStatus } from "../discord/bot";
import { publicCommands } from "../discord/commandCatalog";

const router: IRouter = Router();

router.use(healthRouter);

let statusCache: { at: number; value: ReturnType<typeof getPublicBotStatus> } | null = null;
router.get("/status", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=5");
  if (!statusCache || Date.now() - statusCache.at > 5_000) {
    statusCache = { at: Date.now(), value: getPublicBotStatus() };
  }
  res.json({ ...statusCache.value, publicCommandCount: publicCommands().length });
});

router.get("/commands", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(publicCommands());
});

export default router;
