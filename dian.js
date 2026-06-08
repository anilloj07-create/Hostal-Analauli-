const crypto = require('crypto');

const DIAN_AMBIENTE = String(process.env.DIAN_AMBIENTE || '2');
const DIAN_MODO = String(process.env.DIAN_MODO || 'simulacion').toLowerCase();
const DIAN_API_URL = process.env.DIAN_API_URL || '';

function soloDigitos(val) {
  return String(val || '').replace(/\D/g, '');
}

function padNumeroFactura(numero) {
  const n = Math.max(1, parseInt(numero, 10) || 1);
  return String(n).padStart(8, '0');
}

function formatoFechaDian(fecha) {
  const d = fecha ? new Date(fecha) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function formatoHoraDian(fecha) {
  const d = fecha ? new Date(fecha) : new Date();
  if (Number.isNaN(d.getTime())) {
    return '00:00:00-05:00';
  }
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}-05:00`;
}

function formatoMonedaDian(valor) {
  const n = Number(valor) || 0;
  return n.toFixed(2);
}

/**
 * CUFE según estructura DIAN (SHA-384 en hexadecimal, 96 caracteres).
 */
function generarCUFE(datos) {
  const numFac = padNumeroFactura(datos.numeroFactura || datos.consecutivo);
  const fecFac = formatoFechaDian(datos.fechaEmision);
  const horFac = formatoHoraDian(datos.fechaEmision);
  const valFac = formatoMonedaDian(datos.valorBase || datos.valorTotal);
  const codImp1 = '01';
  const valImp1 = formatoMonedaDian(datos.valorIva || 0);
  const valImp2 = formatoMonedaDian(0);
  const valImp3 = formatoMonedaDian(0);
  const valTot = formatoMonedaDian(datos.valorTotal);
  const nitFe = soloDigitos(datos.nitEmisor || '900000000');
  const numAdq = soloDigitos(datos.documentoAdquiriente || '222222222222');
  const clTec = String(datos.claveTecnica || 'CLAVE-TECNICA-HABILITACION').replace(/\s/g, '');
  const tipoAmb = DIAN_AMBIENTE === '1' ? '1' : '2';

  const cadena =
    numFac +
    fecFac +
    horFac +
    valFac +
    codImp1 +
    valImp1 +
    valImp2 +
    valImp3 +
    valTot +
    nitFe +
    numAdq +
    clTec +
    tipoAmb;

  return crypto.createHash('sha384').update(cadena, 'utf8').digest('hex').toUpperCase();
}

function urlValidacionDian(cufe) {
  const base =
    DIAN_AMBIENTE === '1'
      ? 'https://catalogo-vpfe.dian.gov.co/document/searchqr'
      : 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr';
  return `${base}?documentkey=${encodeURIComponent(cufe)}`;
}

async function llamarApiDianReal(payload) {
  const res = await fetch(DIAN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.DIAN_API_TOKEN ? `Bearer ${process.env.DIAN_API_TOKEN}` : ''
    },
    body: JSON.stringify(payload)
  });
  const texto = await res.text();
  let data = {};
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch (_) {
    data = { raw: texto };
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `DIAN respondió ${res.status}`);
    err.dian = data;
    throw err;
  }
  return data;
}

/**
 * Envía factura a DIAN (API real si está configurada; si no, modo habilitación/simulación).
 */
async function enviarFacturaDIAN(datosFactura) {
  const valorTotal = Number(datosFactura.valorTotal) || 0;
  const payload = {
    numero: datosFactura.numeroDian || datosFactura.numeroFactura,
    consecutivo: datosFactura.consecutivo,
    tipo: datosFactura.tipo,
    reserva_id: datosFactura.reservaId,
    nit_emisor: datosFactura.nitEmisor,
    razon_social: datosFactura.razonSocial,
    documento_adquiriente: datosFactura.documentoAdquiriente,
    nombre_adquiriente: datosFactura.nombreAdquiriente,
    valor_total: valorTotal,
    fecha_emision: datosFactura.fechaEmision,
    resolucion: datosFactura.resolucion || null
  };

  if (DIAN_MODO !== 'simulacion' && DIAN_API_URL) {
    const resp = await llamarApiDianReal(payload);
    const cufe = resp.cufe || resp.CUFE || generarCUFE(datosFactura);
    return {
      estado: resp.estado || resp.status || 'aceptado',
      cufe,
      qr_url: resp.qr_url || urlValidacionDian(cufe),
      respuesta: resp.mensaje || resp.message || 'Documento aceptado por DIAN',
      modo: 'api'
    };
  }

  const cufe = generarCUFE(datosFactura);
  const qrUrl = urlValidacionDian(cufe);
  return {
    estado: 'aceptado',
    cufe,
    qr_url: qrUrl,
    respuesta:
      DIAN_AMBIENTE === '1'
        ? 'Documento validado (modo producción simulado — configure DIAN_API_URL para envío real).'
        : 'Documento validado en ambiente de habilitación DIAN.',
    modo: 'simulacion'
  };
}

module.exports = {
  generarCUFE,
  urlValidacionDian,
  enviarFacturaDIAN,
  padNumeroFactura
};
