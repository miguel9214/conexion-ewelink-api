import dotenv from 'dotenv';
import eWeLink from 'ewelink-api-next';

dotenv.config(); // Cargar variables de entorno

const _config = {
  appId: process.env.APP_ID,
  appSecret: process.env.APP_SECRET,
  region: process.env.REGION || 'us',
  requestRecord: true,
};

if (!_config.appId || !_config.appSecret) {
  throw new Error('⚠️ ERROR: Debes configurar APP_ID y APP_SECRET en Railway o en un archivo .env');
}

export const client = new eWeLink.WebAPI(_config);
export const wsClient = new eWeLink.Ws(_config);

export const redirectUrl = process.env.REDIRECT_URL || 'https://conexion-ewelink-api.up.railway.app/redirectUrl';
export const PORT = process.env.PORT || 8080;

// Función para generar cadenas aleatoriascambios
export const randomString = (length) => {
  return [...Array(length)].map(() => (Math.random() * 36 | 0).toString(36)).join('');
};
