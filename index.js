var https = require('https');

var APP_ID = 'cli_a95fa7ae53b9dbce';
var APP_SECRET = 'ESfxp0RgGLkh0jEVTl6FLfvXZ7GHS1MP';
var APP_TOKEN = 'XmoLbPUCCaQD2wskxt3cnpLjnYb';
var TABLE = 'tblCvgynxPqpBzgl';
var LOG_TABLE = 'tblPQ80s7qYpfipk';

let _token = '';
let _tokenExpiry = 0;

function httpReq(options, postData) {
  return new Promise(function(resolve) {
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ code: -1, msg: 'parse error' }); }
      });
    });
    req.on('error', function() { resolve({ code: -1, msg: 'network error' }); });
    if (postData) req.write(postData);
    req.end();
  });
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  var body = JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET });
  var opts = {
    hostname: 'open.feishu.cn',
    path: '/open-apis/auth/v3/tenant_access_token/internal',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  var result = await httpReq(opts, body);
  _token = result.tenant_access_token || '';
  _tokenExpiry = Date.now() + 3500 * 1000;
  return _token;
}

async function feishu(method, path, body) {
  var tk = await getToken();
  var bodyStr = body ? JSON.stringify(body) : null;
  var opts = {
    hostname: 'open.feishu.cn',
    path: '/open-apis' + path,
    method: method,
    headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' }
  };
  if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  return httpReq(opts, bodyStr);
}

function extractVal(v) {
  if (!v && v !== 0) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return (v[0] && (v[0].text || v[0].name || '')) || '';
  return '';
}

function moldFrom(r) {
  var f = r.fields || {};
  return {
    record_id: r.record_id,
    fields: {
      id: extractVal(f['模具编号']),
      subId: extractVal(f['子模具号']),
      status: extractVal(f['当前状态（文本）']) || '在库',
      location: extractVal(f['存放位置']) || '',
      sapId: extractVal(f['SAP设备号']),
      repairCount: parseFloat(extractVal(f['累计维修次数'])) || 0,
      lastRepair: f['末次维修时间'] ? extractVal(f['末次维修时间']).slice(0, 10) : '—',
      remark: extractVal(f['备注']),
    }
  };
}

function readBody(req) {
  return new Promise(function(resolve) {
    var chunks = [];
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() { resolve(Buffer.concat(chunks).toString()); });
  });
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  var pathname = (req.url || '').split('?')[0];

  try {
    // GET /api/molds
    if (pathname === '/api/molds' && req.method === 'GET') {
      var result = await feishu('GET', '/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TABLE + '/records?page_size=500');
      if (result.code !== 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.msg }));
        return;
      }
      var molds = (result.data && result.data.items || []).map(moldFrom);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ molds: molds }));
      return;
    }

    // GET /api/logs
    if (pathname === '/api/logs' && req.method === 'GET') {
      var result = await feishu('GET', '/bitable/v1/apps/' + APP_TOKEN + '/tables/' + LOG_TABLE + '/records?page_size=500');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: (result.data && result.data.items) || [] }));
      return;
    }

    // POST /api/molds
    if (pathname === '/api/molds' && req.method === 'POST') {
      var bodyStr = await readBody(req);
      var parsed = JSON.parse(bodyStr);
      var fields = parsed.fields;
      var createResult = await feishu('POST', '/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TABLE + '/records', { fields: fields });
      if (createResult.code !== 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: createResult.msg }));
        return;
      }
      await feishu('POST', '/bitable/v1/apps/' + APP_TOKEN + '/tables/' + LOG_TABLE + '/records', {
        fields: {
          '模具编号': (fields['模具编号'] || '') + (fields['子模具号'] || ''),
          '变动字段': '当前状态',
          '原值': '',
          '新值': '新模入库',
          '变动时间': Date.now(),
          '备注': '新模入库'
        }
      });
      var rid = createResult.data && createResult.data.record && createResult.data.record.record_id;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ record_id: rid || 'ok' }));
      return;
    }

    // PUT /api/molds/:id
    if (pathname.indexOf('/api/molds/') === 0 && req.method === 'PUT') {
      var recordId = pathname.split('/')[3];
      var bodyStr2 = await readBody(req);
      var parsed2 = JSON.parse(bodyStr2);
      var fields2 = parsed2.fields;
      var log2 = parsed2.log;
      var updateResult = await feishu('PUT', '/bitable/v1/apps/' + APP_TOKEN + '/tables/' + TABLE + '/records/' + recordId, { fields: fields2 });
      if (updateResult.code !== 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: updateResult.msg }));
        return;
      }
      if (log2) {
        await feishu('POST', '/bitable/v1/apps/' + APP_TOKEN + '/tables/' + LOG_TABLE + '/records', {
          fields: {
            '模具编号': log2.moldId,
            '变动字段': '当前状态',
            '原值': log2.from,
            '新值': log2.to,
            '变动时间': Date.now(),
            '备注': log2.remark || ''
          }
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = handler;
