import Koa from "koa"; // Framework para crear el servidor web
import bodyParser from "koa-bodyparser"; // Middleware para analizar el cuerpo de las peticiones HTTP
import Router from "koa-router"; // Enrutador para manejar rutas HTTP
import cors from "@koa/cors"; // Middleware para permitir peticiones de origen cruzado (CORS)
import { client, redirectUrl, randomString } from "./config.js"; // Importación de configuraciones
import * as fs from "fs"; // Módulo para trabajar con el sistema de archivos
import open from "open"; // Módulo para abrir URLs en el navegador predeterminado
import { WebSocketServer, WebSocket } from "ws"; // Módulos para crear servidor WebSocket

// Crear aplicación Koa
const app = new Koa();

// Configurar middlewares
app.use(bodyParser()); // Analizar cuerpos de peticiones
app.use(
  cors({
    // Configurar CORS para permitir peticiones desde cualquier origen
    origin: "*", // Permitir todos los orígenes
    allowMethods: ["GET", "POST", "PUT", "DELETE"], // Métodos HTTP permitidos
    allowHeaders: ["Content-Type", "Authorization"], // Cabeceras permitidas
  })
);

// Crear un enrutador
const router = new Router();

// Iniciar servidor HTTP en el puerto 8000
const server = app.listen(8000);

// Crear servidor WebSocket utilizando el mismo servidor HTTP
const wss = new WebSocketServer({ server });

// Manejar eventos de conexión WebSocket
wss.on("connection", (ws) => {
  console.log("Nueva conexión WebSocket establecida");

  // Enviar mensaje de bienvenida al cliente que se conecta
  ws.send(
    JSON.stringify({
      type: "welcome",
      message: "Conexión WebSocket establecida",
    })
  );

  // Manejar mensajes recibidos del cliente
  ws.on("message", (message) => {
    console.log(`Mensaje recibido: ${message}`);
    // Responder al cliente
    ws.send(JSON.stringify({ type: "response", message: "Mensaje recibido" }));
  });

  // Manejar cierre de conexión
  ws.on("close", () => {
    console.log("Conexión WebSocket cerrada");
  });

  // Enviar el estado actual de los dispositivos al nuevo cliente
  broadcastDevicesStatus();
});

/**
 * Función para obtener la lista simplificada de dispositivos eWeLink
 * Extrae solo la información relevante de cada dispositivo
 */
const getSimplifiedDevices = async () => {
  // Verificar si existe el archivo de token
  if (!fs.existsSync("./token.json")) {
    throw new Error("token.json not found, please run login.js first");
  }

  // Leer y configurar token de autenticación
  let LoggedInfo = JSON.parse(fs.readFileSync("./token.json", "utf-8"));
  client.at = LoggedInfo.data?.accessToken;
  client.region = LoggedInfo?.region || "eu";
  client.setUrl(LoggedInfo?.region || "eu");

  // Renovar token si ha expirado pero el refresh token es válido
  if (
    LoggedInfo.data?.atExpiredTime < Date.now() &&
    LoggedInfo.data?.rtExpiredTime > Date.now()
  ) {
    console.log("Token expired, refreshing token");
    const refreshStatus = await client.user.refreshToken({
      rt: LoggedInfo.data?.refreshToken,
    });

    // Si la renovación fue exitosa, actualizar el archivo token.json
    if (refreshStatus.error === 0) {
      fs.writeFileSync(
        "./token.json",
        JSON.stringify({
          status: 200,
          responseTime: 0,
          error: 0,
          msg: "",
          data: {
            accessToken: refreshStatus?.data?.at,
            atExpiredTime: Date.now() + 2592000000, // 30 días
            refreshToken: refreshStatus?.data?.rt,
            rtExpiredTime: Date.now() + 5184000000, // 60 días
          },
          region: client.region,
        })
      );
      LoggedInfo = JSON.parse(fs.readFileSync("./token.json", "utf-8"));
    }
  }

  // Si el refresh token también ha expirado, informar al usuario
  if (LoggedInfo.data?.rtExpiredTime < Date.now()) {
    console.log(
      "Failed to refresh token, need to log in again to obtain token"
    );
    return { error: 1, msg: "Token expired, please login again" };
  }

  // Obtener la lista de dispositivos
  try {
    let response = await client.device.getAllThingsAllPages({});

    if (response?.error === 0 && response?.data?.thingList) {
      // Filtrar solo dispositivos (itemType=1) y mapear a formato simplificado
      const devices = response.data.thingList
        .filter((thing) => thing.itemType === 1)
        .map((thing) => {
          const device = thing.itemData;

          // Crear objeto con información básica del dispositivo
          const simplifiedDevice = {
            id: device.deviceid,
            name: device.name || "Unnamed Device",
            type: device.extra?.uiid || "Unknown",
            online: device.online || false,
            model: device.productModel || device.extra?.model || "Unknown",
          };

          // Añadir información específica según el tipo de dispositivo
          if (device.extra?.uiid === 1) {
            // Dispositivo de un solo canal (interruptor simple)
            simplifiedDevice.state = device.params?.switch || "Unknown";
          } else if (device.extra?.uiid === 162) {
            // Dispositivo de 3 vías (interruptor múltiple)
            simplifiedDevice.channels = (device.params?.switches || []).map(
              (sw, index) => ({
                channel: index + 1,
                name: getChannelName(index + 1), // Nombre personalizado
                state: sw.switch || "Unknown",
              })
            );
          } else if (device.extra?.uiid === 102) {
            // Sensor de temperatura y humedad
            simplifiedDevice.temperature = device.params?.currentTemperature;
            simplifiedDevice.humidity = device.params?.currentHumidity;
          }

          return simplifiedDevice;
        });

      return {
        error: 0,
        total: devices.length,
        devices: devices,
      };
    } else {
      return {
        error: response.error,
        msg: response.msg || "Error getting devices",
      };
    }
  } catch (e) {
    console.error(e);
    return { error: 1, msg: e.message || "Error getting devices" };
  }
};

/**
 * Función para obtener el nombre personalizado de un canal
 * @param {number} channelNumber - Número del canal
 * @returns {string} Nombre personalizado del canal
 */
const getChannelName = (channelNumber) => {
  switch (channelNumber) {
    case 1:
      return "POLICIA";
    case 2:
      return "EMERGENCIA";
    case 3:
      return "BOMBEROS";
    default:
      return `Canal ${channelNumber}`;
  }
};

/**
 * Función para transmitir el estado actual de los dispositivos a todos los clientes WebSocket
 * Esta función debe llamarse periódicamente o cuando se detecte un cambio en algún dispositivo
 */
const broadcastDevicesStatus = async () => {
  try {
    // Obtener el estado actual de los dispositivos
    const devices = await getSimplifiedDevices();

    // Enviar la información actualizada a todos los clientes conectados
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "devicesUpdate",
            devices: devices.devices,
          })
        );
      }
    });
  } catch (error) {
    console.error("Error al transmitir estado de dispositivos:", error);
  }
};

/**
 * Función para controlar un dispositivo específico
 * @param {string} deviceId - ID del dispositivo a controlar
 * @param {object} params - Parámetros de control (ej: {switch: 'on'})
 * @returns {object} Resultado de la operación
 */
const controlSpecificDevice = async (deviceId, params) => {
  // Verificar si existe el archivo de token
  if (!fs.existsSync("./token.json")) {
    throw new Error("token.json not found, please run login.js first");
  }

  // Leer y configurar token de autenticación
  let LoggedInfo = JSON.parse(fs.readFileSync("./token.json", "utf-8"));
  client.at = LoggedInfo.data?.accessToken;
  client.region = LoggedInfo?.region || "eu";
  client.setUrl(LoggedInfo?.region || "eu");

  // Renovar token si ha expirado
  if (
    LoggedInfo.data?.atExpiredTime < Date.now() &&
    LoggedInfo.data?.rtExpiredTime > Date.now()
  ) {
    console.log("Token expired, refreshing token");
    const refreshStatus = await client.user.refreshToken({
      rt: LoggedInfo.data?.refreshToken,
    });
    if (refreshStatus.error === 0) {
      fs.writeFileSync(
        "./token.json",
        JSON.stringify({
          status: 200,
          responseTime: 0,
          error: 0,
          msg: "",
          data: {
            accessToken: refreshStatus?.data?.at,
            atExpiredTime: Date.now() + 2592000000,
            refreshToken: refreshStatus?.data?.rt,
            rtExpiredTime: Date.now() + 5184000000,
          },
          region: client.region,
        })
      );
      LoggedInfo = JSON.parse(fs.readFileSync("./token.json", "utf-8"));
    }
  }

  if (LoggedInfo.data?.rtExpiredTime < Date.now()) {
    console.log(
      "Failed to refresh token, need to log in again to obtain token"
    );
    return { error: 1, msg: "Token expired, please login again" };
  }

  // Enviar comando al dispositivo
  try {
    console.log(
      `Attempting to control device ${deviceId} with params:`,
      params
    );
    const result = await client.device.setThingStatus({
      type: 1, // Tipo 1 = dispositivo
      id: deviceId, // ID del dispositivo
      params: params, // Parámetros de control
    });

    console.log("Control result:", result);

    // Notificar a todos los clientes WebSocket conectados sobre el cambio específico
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "deviceUpdate",
            deviceId: deviceId,
            params: params,
          })
        );
      }
    });

    // También transmitir el estado completo después de una breve pausa
    // para asegurarnos de que el cambio se ha aplicado
    setTimeout(broadcastDevicesStatus, 1000);

    return result;
  } catch (e) {
    console.error("Error controlling device:", e);
    return { error: 1, msg: e.message || "Error controlling device" };
  }
};

// Ruta para iniciar el proceso de login OAuth
router.get("/login", async (ctx) => {
  // Generar URL de inicio de sesión
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl: redirectUrl, // URL de redirección después del login
    grantType: "authorization_code", // Tipo de autorización
    state: randomString(10), // Estado aleatorio para seguridad
  });
  // Redirigir al usuario a la página de login
  ctx.redirect(loginUrl);
});

// Ruta que maneja la redirección después del login exitoso
router.get("/redirectUrl", async (ctx) => {
  const { code, region } = ctx.request.query;
  console.log(code, region);

  // Intercambiar código de autorización por token
  const res = await client.oauth.getToken({
    region,
    redirectUrl,
    code,
  });
  res["region"] = region;

  // Guardar token en archivo
  fs.writeFileSync("./token.json", JSON.stringify(res));
  console.log(res);
  ctx.body = res;
});

// Ruta para obtener la lista de dispositivos
router.get("/devices", async (ctx) => {
  try {
    const devices = await getSimplifiedDevices();
    ctx.body = devices;
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: 1, msg: e.message || "Internal Server Error" };
  }
});

// Ruta para controlar un dispositivo específico
router.post("/control/:deviceId", async (ctx) => {
  try {
    const { deviceId } = ctx.params; // Obtener ID del dispositivo de la URL
    const params = ctx.request.body; // Obtener parámetros del cuerpo de la petición
    const result = await controlSpecificDevice(deviceId, params);
    ctx.body = result;
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: 1, msg: e.message || "Internal Server Error" };
  }
});

// Añadir un intervalo para actualizar regularmente el estado de los dispositivos
// Esto garantiza que se detecten cambios realizados manualmente
const devicePollingInterval = setInterval(broadcastDevicesStatus, 5000);

// Agregar manejo de cierre del servidor para limpiar el intervalo
process.on("SIGINT", () => {
  clearInterval(devicePollingInterval);
  server.close(() => {
    console.log("Servidor cerrado");
    process.exit(0);
  });
});

// Registrar rutas en la aplicación
app.use(router.routes());

// Mensajes informativos en la consola
console.info("Server is running at http://127.0.0.1:8000/");
console.info(
  "Login URL: http://127.0.0.1:8000/login, automatically open browser in three seconds"
);
console.info(
  "Simplified Devices URL: http://127.0.0.1:8000/devices (JSON API)"
);

// Abrir navegador automáticamente después de 3 segundos
setTimeout(async () => {
  await open("http://127.0.0.1:8000/login");
}, 3000);
