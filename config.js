import eWeLink from 'ewelink-api-next';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const _config = {
  appId: process.env.APP_ID, 
  appSecret: process.env.APP_SECRET,
  region: process.env.REGION || 'us',
  requestRecord: true,
};

if (!_config.appId || !_config.appSecret) {
  throw new Error('Please configure APP_ID and APP_SECRET in environment variables');
}

export const client = new eWeLink.WebAPI(_config);
export const wsClient = new eWeLink.Ws(_config);

export const redirectUrl = process.env.REDIRECT_URL || 'https://conexion-ewelink-api.up.railway.app/redirectUrl';

export const updateRegion = (newRegion) => {
  _config.region = newRegion;
  console.log(`Región actualizada a: ${newRegion}`);
};

export const randomString = (length) => {
  return [...Array(length)].map(()=>(Math.random()*36|0).toString(36)).join('');
};
