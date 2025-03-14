import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import cors from '@koa/cors';
import { client, redirectUrl, randomString } from './config.js';
import * as fs from 'fs';
import open from 'open';
import { WebSocketServer } from 'ws'; // Importa WebSocketServer desde 'ws'

const app = new Koa();

app.use(bodyParser());
app.use(cors({
  origin: '*', // Permite todas las solicitudes de origen cruzado
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

const router = new Router();

// Crear un servidor HTTP
const server = app.listen(8000);

// Crear un servidor WebSocket
const wss = new WebSocketServer({ server }); // Usa WebSocketServer en lugar de WebSocket.Server

// Manejar conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket establecida');

  // Enviar un mensaje de bienvenida al cliente
  ws.send(JSON.stringify({ type: 'welcome', message: 'Conexión WebSocket establecida' }));

  // Manejar mensajes recibidos del cliente
  ws.on('message', (message) => {
    console.log(`Mensaje recibido: ${message}`);
    // Aquí puedes manejar los mensajes recibidos del cliente
    // Por ejemplo, podrías enviar una respuesta basada en el mensaje recibido
    ws.send(JSON.stringify({ type: 'response', message: 'Mensaje recibido' }));
  });

  // Manejar el cierre de la conexión
  ws.on('close', () => {
    console.log('Conexión WebSocket cerrada');
  });
});

// Función para obtener solo los datos relevantes de los dispositivos
const getSimplifiedDevices = async () => {
  // Si el archivo no existe, reportar un error directamente
  if (!fs.existsSync('./token.json')) {
    throw new Error('token.json not found, please run login.js first');
  }

  // Obtener token
  let LoggedInfo = JSON.parse(fs.readFileSync('./token.json', 'utf-8'));
  client.at = LoggedInfo.data?.accessToken;
  client.region = LoggedInfo?.region || 'eu';
  client.setUrl(LoggedInfo?.region || 'eu');

  // Comprobar si el token ha expirado y renovarlo si es necesario
  if (
    LoggedInfo.data?.atExpiredTime < Date.now() &&
    LoggedInfo.data?.rtExpiredTime > Date.now()
  ) {
    console.log('Token expired, refreshing token');
    const refreshStatus = await client.user.refreshToken({
      rt: LoggedInfo.data?.refreshToken,
    });
    if (refreshStatus.error === 0) {
      fs.writeFileSync(
        './token.json',
        JSON.stringify({
          status: 200,
          responseTime: 0,
          error: 0,
          msg: '',
          data: {
            accessToken: refreshStatus?.data?.at,
            atExpiredTime: Date.now() + 2592000000,
            refreshToken: refreshStatus?.data?.rt,
            rtExpiredTime: Date.now() + 5184000000,
          },
          region: client.region,
        })
      );
      LoggedInfo = JSON.parse(fs.readFileSync('./token.json', 'utf-8'));
    }
  }

  if (LoggedInfo.data?.rtExpiredTime < Date.now()) {
    console.log('Failed to refresh token, need to log in again to obtain token');
    return { error: 1, msg: 'Token expired, please login again' };
  }

  // Obtener lista de dispositivos
  try {
    let response = await client.device.getAllThingsAllPages({});

    if (response?.error === 0 && response?.data?.thingList) {
      // Extraer solo los dispositivos (no grupos u otros elementos)
      const devices = response.data.thingList
        .filter(thing => thing.itemType === 1)
        .map(thing => {
          const device = thing.itemData;

          // Crear un objeto simplificado con solo la información relevante
          const simplifiedDevice = {
            id: device.deviceid,
            name: device.name || 'Unnamed Device',
            type: device.extra?.uiid || 'Unknown',
            online: device.online || false,
            model: device.productModel || device.extra?.model || 'Unknown',
          };

          // Agregar información específica de estado según el tipo de dispositivo
          if (device.extra?.uiid === 1) {
            // Dispositivo de un solo canal
            simplifiedDevice.state = device.params?.switch || 'Unknown';
          } else if (device.extra?.uiid === 4) {
            // Dispositivo multicanal
            simplifiedDevice.channels = (device.params?.switches || []).map((sw, index) => ({
              channel: index + 1,
              state: sw.switch || 'Unknown'
            }));
          } else if (device.extra?.uiid === 102) {
            // Dispositivo con sensor de temperatura y humedad
            simplifiedDevice.temperature = device.params?.currentTemperature;
            simplifiedDevice.humidity = device.params?.currentHumidity;
          }

          return simplifiedDevice;
        });

      return {
        error: 0,
        total: devices.length,
        devices: devices
      };
    } else {
      return { error: response.error, msg: response.msg || 'Error getting devices' };
    }
  } catch (e) {
    console.error(e);
    return { error: 1, msg: e.message || 'Error getting devices' };
  }
};

// Función para controlar un dispositivo específico
const controlSpecificDevice = async (deviceId, params) => {
  if (!fs.existsSync('./token.json')) {
    throw new Error('token.json not found, please run login.js first');
  }

  // Obtener token
  let LoggedInfo = JSON.parse(fs.readFileSync('./token.json', 'utf-8'));
  client.at = LoggedInfo.data?.accessToken;
  client.region = LoggedInfo?.region || 'eu';
  client.setUrl(LoggedInfo?.region || 'eu');

  // Comprobar si el token ha expirado y renovarlo si es necesario
  if (
    LoggedInfo.data?.atExpiredTime < Date.now() &&
    LoggedInfo.data?.rtExpiredTime > Date.now()
  ) {
    console.log('Token expired, refreshing token');
    const refreshStatus = await client.user.refreshToken({
      rt: LoggedInfo.data?.refreshToken,
    });
    if (refreshStatus.error === 0) {
      fs.writeFileSync(
        './token.json',
        JSON.stringify({
          status: 200,
          responseTime: 0,
          error: 0,
          msg: '',
          data: {
            accessToken: refreshStatus?.data?.at,
            atExpiredTime: Date.now() + 2592000000,
            refreshToken: refreshStatus?.data?.rt,
            rtExpiredTime: Date.now() + 5184000000,
          },
          region: client.region,
        })
      );
      LoggedInfo = JSON.parse(fs.readFileSync('./token.json', 'utf-8'));
    }
  }

  if (LoggedInfo.data?.rtExpiredTime < Date.now()) {
    console.log('Failed to refresh token, need to log in again to obtain token');
    return { error: 1, msg: 'Token expired, please login again' };
  }

  try {
    const result = await client.device.setThingStatus({
      type: 1,
      id: deviceId,
      params: params,
    });

    // Notificar a todos los clientes conectados que los dispositivos han sido actualizados
    const devices = await getSimplifiedDevices();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'devices_updated',
          devices: devices
        }));
      }
    });

    return result;
  } catch (e) {
    console.error(e);
    return { error: 1, msg: e.message || 'Error controlling device' };
  }
};

router.get('/login', async (ctx) => {
  // Obtener URL de inicio de sesión
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl: redirectUrl,
    grantType: 'authorization_code',
    state: randomString(10),
  });
  // Redirigir automáticamente a la URL de inicio de sesión
  ctx.redirect(loginUrl);
});

router.get('/redirectUrl', async (ctx) => {
  const { code, region } = ctx.request.query;
  console.log(code, region);
  const res = await client.oauth.getToken({
    region,
    redirectUrl,
    code,
  });
  res['region'] = region;
  // Puedes escribir tu propio código aquí
  fs.writeFileSync('./token.json', JSON.stringify(res));
  console.log(res);
  ctx.body = res;
});

// Nueva ruta para obtener dispositivos simplificados
router.get('/devices', async (ctx) => {
  try {
    const devices = await getSimplifiedDevices();
    ctx.body = devices;
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: 1, msg: e.message || 'Internal Server Error' };
  }
});

// Ruta para controlar un dispositivo específico
router.post('/control/:deviceId', async (ctx) => {
  try {
    const { deviceId } = ctx.params;
    const params = ctx.request.body;
    const result = await controlSpecificDevice(deviceId, params);
    ctx.body = result;
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: 1, msg: e.message || 'Internal Server Error' };
  }
});

// Ruta para obtener una página HTML que muestra los dispositivos simplificados
router.get('/devices-ui', async (ctx) => {
  try {
    const devicesData = await getSimplifiedDevices();

    ctx.type = 'html';
    ctx.body = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>eWeLink Devices</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .container {
            max-width: 1000px;
            margin: 0 auto;
          }
          h1 {
            color: #333;
            text-align: center;
          }
          .device-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-top: 20px;
          }
          .device {
            background-color: white;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          }
          .device h3 {
            margin-top: 0;
            color: #2c3e50;
          }
          .status-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 12px;
            margin-left: 8px;
          }
          .online {
            background-color: #2ecc71;
            color: white;
          }
          .offline {
            background-color: #e74c3c;
            color: white;
          }
          .device-info {
            margin: 10px 0;
          }
          .controls {
            margin-top: 15px;
          }
          button {
            background-color: #3498db;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
            margin-bottom: 8px;
          }
          button:hover {
            background-color: #2980b9;
          }
          .channel {
            margin-bottom: 10px;
            padding: 8px;
            background-color: #f8f9fa;
            border-radius: 4px;
          }
          .success {
            color: green;
            margin-top: 10px;
          }
          .error {
            color: red;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>eWeLink Devices (${devicesData.total || 0})</h1>
          <div class="device-list" id="deviceList">
            ${devicesData.error ? `<p class="error">${devicesData.msg}</p>` : ''}
          </div>
        </div>

        <script>
          // Conectar al servidor WebSocket
          const ws = new WebSocket('ws://127.0.0.1:8000');

          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);

            if (message.type === 'devices_updated') {
              // Actualizar los datos de los dispositivos
              devicesData = message.devices;

              // Volver a renderizar los dispositivos
              renderDevices();
            }
          };

          // Los datos de dispositivos que se obtuvieron del servidor
          let devicesData = ${JSON.stringify(devicesData)};

          function renderDevices() {
            const deviceListElement = document.getElementById('deviceList');

            if (devicesData.error) {
              deviceListElement.innerHTML = \`<p class="error">\${devicesData.msg}</p>\`;
              return;
            }

            const devices = devicesData.devices || [];

            if (devices.length === 0) {
              deviceListElement.innerHTML = '<p>No devices found</p>';
              return;
            }

            let html = '';

            devices.forEach(device => {
              html += \`
                <div class="device" id="device-\${device.id}">
                  <h3>
                    \${device.name}
                    <span class="status-badge \${device.online ? 'online' : 'offline'}">
                      \${device.online ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </h3>
                  <div class="device-info">
                    <p><strong>Model:</strong> \${device.model}</p>
                    <p><strong>Type:</strong> \${device.type}</p>
              \`;

              // Mostrar estado específico según el tipo de dispositivo
              if (device.state) {
                html += \`<p><strong>State:</strong> \${device.state}</p>\`;
              }

              if (device.temperature) {
                html += \`<p><strong>Temperature:</strong> \${device.temperature}°C</p>\`;
              }

              if (device.humidity) {
                html += \`<p><strong>Humidity:</strong> \${device.humidity}%</p>\`;
              }

              html += \`</div><div class="controls">\`;

              // Agregar controles específicos según el tipo de dispositivo
              if (device.type == 1) {
                html += \`
                  <button onclick="controlDevice('\${device.id}', {'switch': 'on'})">Turn ON</button>
                  <button onclick="controlDevice('\${device.id}', {'switch': 'off'})">Turn OFF</button>
                \`;
              } else if (device.type == 4 && device.channels) {
                device.channels.forEach(channel => {
                  html += \`
                    <div class="channel">
                      <span>Channel \${channel.channel}: \${channel.state}</span>
                      <div style="margin-top: 5px;">
                        <button onclick="controlDevice('\${device.id}', {switches: [{switch: 'on', outlet: \${channel.channel - 1}}]})">ON</button>
                        <button onclick="controlDevice('\${device.id}', {switches: [{switch: 'off', outlet: \${channel.channel - 1}}]})">OFF</button>
                      </div>
                    </div>
                  \`;
                });
              }

              html += \`
                  </div>
                  <div id="status-\${device.id}"></div>
                </div>
              \`;
            });

            deviceListElement.innerHTML = html;
          }

          async function controlDevice(deviceId, params) {
            try {
              const statusElement = document.getElementById(\`status-\${deviceId}\`);
              statusElement.innerHTML = '<p>Processing...</p>';

              const response = await fetch(\`/control/\${deviceId}\`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
              });

              const result = await response.json();

              if (result.error === 0) {
                statusElement.innerHTML = '<p class="success">Command sent successfully!</p>';
              } else {
                statusElement.innerHTML = \`<p class="error">Error: \${result.msg || 'Unknown error'}</p>\`;
              }
            } catch (error) {
              const statusElement = document.getElementById(\`status-\${deviceId}\`);
              statusElement.innerHTML = \`<p class="error">Error: \${error.message || 'Unknown error'}</p>\`;
            }
          }

          // Renderizar los dispositivos cuando la página se cargue
          window.onload = renderDevices;
        </script>
      </body>
      </html>
    `;
  } catch (e) {
    ctx.status = 500;
    ctx.body = `<html><body><h1>Error</h1><p>${e.message || 'Internal Server Error'}</p></body></html>`;
  }
});

app.use(router.routes());

console.info('Server is running at http://127.0.0.1:8000/');
console.info('Login URL: http://127.0.0.1:8000/login, automatically open browser in three seconds');
console.info('Simplified Devices URL: http://127.0.0.1:8000/devices (JSON API)');
console.info('Devices UI URL: http://127.0.0.1:8000/devices-ui (Web Interface)');

setTimeout(async () => {
  await open("http://127.0.0.1:8000/login");
}, 3000);