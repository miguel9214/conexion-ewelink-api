import Koa from "koa";
import bodyParser from "koa-bodyparser";
import Router from "koa-router";
import cors from "@koa/cors";
import { client, redirectUrl, randomString, PORT } from "./config.js";
import fs from "fs";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";

dotenv.config();

const app = new Koa();
app.use(bodyParser());
app.use(cors({ origin: "*", allowMethods: ["GET", "POST"], allowHeaders: ["Content-Type", "Authorization"] }));

const router = new Router();
const server = app.listen(PORT, () => {
  console.info(`🚀 Servidor corriendo en: http://127.0.0.1:${PORT}/`);
});

const wss = new WebSocketServer({ server });

let cachedDevices = { devices: [], total: 0, error: 0 };

// Función para obtener información del token
const getTokenInfo = async () => {
  if (!fs.existsSync("./token.json")) {
    throw new Error("⚠️ token.json no encontrado, ejecuta login primero.");
  }

  let tokenInfo = JSON.parse(fs.readFileSync("./token.json", "utf-8"));
  client.at = tokenInfo.data?.accessToken;
  client.region = tokenInfo?.region || "us";
  client.setUrl(tokenInfo?.region || "us");

  if (tokenInfo.data?.atExpiredTime < Date.now() && tokenInfo.data?.rtExpiredTime > Date.now()) {
    console.log("🔄 Token expirado, refrescando...");
    const refreshStatus = await client.user.refreshToken({ rt: tokenInfo.data?.refreshToken });

    if (refreshStatus.error === 0) {
      tokenInfo = {
        status: 200,
        responseTime: 0,
        error: 0,
        data: {
          accessToken: refreshStatus.data.at,
          atExpiredTime: Date.now() + 2592000000,
          refreshToken: refreshStatus.data.rt,
          rtExpiredTime: Date.now() + 5184000000,
        },
        region: client.region,
      };

      fs.writeFileSync("./token.json", JSON.stringify(tokenInfo));
    }
  }

  if (tokenInfo.data?.rtExpiredTime < Date.now()) {
    throw new Error("⚠️ Token expirado, por favor inicia sesión nuevamente.");
  }

  return tokenInfo;
};

// Función para obtener dispositivos
const getSimplifiedDevices = async () => {
  try {
    await getTokenInfo();
    const response = await client.device.getAllThingsAllPages({});

    if (response?.error === 0 && response?.data?.thingList) {
      const devices = response.data.thingList
        .filter((thing) => thing.itemType === 1)
        .map((thing) => ({
          id: thing.itemData.deviceid,
          name: thing.itemData.name || "Unnamed Device",
          type: thing.itemData.extra?.uiid || "Unknown",
          online: thing.itemData.online || false,
          model: thing.itemData.productModel || thing.itemData.extra?.model || "Unknown",
        }));

      cachedDevices = { error: 0, total: devices.length, devices };
      return cachedDevices;
    } else {
      return { error: response.error, msg: response.msg || "Error obteniendo dispositivos" };
    }
  } catch (e) {
    console.error(e);
    return { error: 1, msg: e.message || "Error obteniendo dispositivos" };
  }
};

// Rutas
router.get("/", async (ctx) => {
  ctx.body = { message: "🚀 API eWeLink funcionando correctamente" };
});

router.get("/login", async (ctx) => {
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl,
    grantType: "authorization_code",
    state: randomString(10),
  });
  ctx.redirect(loginUrl);
});

router.get("/redirectUrl", async (ctx) => {
  const { code, region } = ctx.request.query;
  console.log("🔑 Código recibido:", code, "Región:", region);
  const res = await client.oauth.getToken({ region, redirectUrl, code });
  res["region"] = region;
  fs.writeFileSync("./token.json", JSON.stringify(res));
  ctx.body = res;
});

router.get("/devices", async (ctx) => {
  ctx.body = await getSimplifiedDevices();
});

router.post("/control/:deviceId", async (ctx) => {
  const { deviceId } = ctx.params;
  const params = ctx.request.body;
  const result = await client.device.setThingStatus({ type: 1, id: deviceId, params });
  ctx.body = result;
});

app.use(router.routes());
