const https = require('https');

const FEISHU = 'open.feishu.cn';
const APP_ID = 'cli_a95fa7ae53b9dbce';
const APP_SECRET = 'ESfxp0RgGLkh0jEVTl6FLfvXZ7GHS1MP';
const APP_TOKEN = 'XmoLbPUCCaQD2wskxt3cnpLjnYb';
const TABLE = 'tblCvgynxPqpBzgl';
const LOG_TABLE = 'tblPQ80s7qYpfipk';

let token = '';
let tokenExpiry = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiry) return token;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET });
    const opts = {
      hostname: FEISHU, path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { const j = JSON.parse(d); token = j.tenant_access_token || ''; tokenExpiry = Date.now() + 3500 * 1000; resolve(token); }
        catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.write(body); req.end();
  });
}

async function feishu(method, path, body) {
  const tk = await getToken();
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: FEISHU, path: '/open-apis' + path,
      method, headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ code: -1 }); } });
    });
    req.on('error', () => resolve({ code: -1, msg: 'network error' }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function extract(v) {
  if (!v && v !== 0) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return (v[0] && (v[0].text || v[0].name || '')) || '';
  return '';
}

function moldFrom(r) {
  const f = r.fields || {};
  return {
    record_id: r.record_id,
    fields: {
      id: extract(f['模具编号']),
      subId: extract(f['子模具号']),
      status: extract(f['当前状态（文本）']) || '在库',
      location: extract(f['存放位置']) || '',
      sapId: extract(f['SAP设备号']),
      repairCount: parseFloat(extract(f['累计维修次数'])) || 0,
      lastRepair: f['末次维修时间'] ? extract(f['末次维修时间']).slice(0, 10) : '—',
      remark: extract(f['备注']),
    }
  };
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const { method, url } = req;
  const u = new URL(url, 'https://mold-api.example.com');

  try {
    // GET /api/molds
    if (u.pathname === '/api/molds' && method === 'GET') {
      const result = await feishu('GET', `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE}/records?page_size=500`);
      if (result.code !== 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: result.msg })); return; }
      const molds = (result.data?.items || []).map(moldFrom);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ molds }));
      return;
    }

    // GET /api/logs
    if (u.pathname === '/api/logs' && method === 'GET') {
      const result = await feishu('GET', `/bitable/v1/apps/${APP_TOKEN}/tables/${LOG_TABLE}/records?page_size=500`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: result.data?.items || [] }));
      return;
    }

    // POST /api/molds - create
    if (u.pathname === '/api/molds' && method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const { fields } = JSON.parse(body);
        const result = await feishu('POST', `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE}/records`, { fields });
        if (result.code !== 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: result.msg })); return; }
        // log
        await feishu('POST', `/bitable/v1/apps/${APP_TOKEN}/tables/${LOG_TABLE}/records`, {
          fields: {
            '模具编号': (fields['模具编号'] || '') + (fields['子模具号'] || ''),
            '变动字段': '当前状态', '原值': '', '新值': '新模入库',
            '变动时间': Date.now(), '备注': '新模入库'
          }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ record_id: result.data?.record?.record_id }));
      });
      return;
    }

    // PUT /api/molds/:id - update
    if (u.pathname.startsWith('/api/molds/') && method === 'PUT') {
      const recordId = u.pathname.split('/')[3];
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const { fields, log } = JSON.parse(body);
        const result = await feishu('PUT', `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE}/records/${recordId}`, { fields });
        if (result.code !== 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: result.msg })); return; }
        if (log) {
          await feishu('POST', `/bitable/v1/apps/${APP_TOKEN}/tables/${LOG_TABLE}/records`, {
            fields: {
              '模具编号': log.moldId, '变动字段': '当前状态',
              '原值': log.from, '新值': log.to,
              '变动时间': Date.now(), '备注': log.remark || ''
            }
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
};
