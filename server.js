/**
 * 电商素材工作台 · 本地服务端
 * 零第三方依赖：仅使用 Node 内置 http / fs / path / fetch
 *
 * 职责：
 *   1) 静态托管 index.html（同源，避免跨域）
 *   2) POST /api/generate —— 读取服务端环境变量中的 API Key，调用 DeepSeek，回传结构化 JSON
 *
 * 安全约定：
 *   - API Key 只从 .env.local 或进程环境变量读取，绝不下发到浏览器
 *   - 错误响应只透传状态码、错误信息和 Request ID，不包含密钥或请求头
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const API_URL = 'https://api.deepseek.com/chat/completions';
const MAX_BODY = 100 * 1024; // 100 KB，防止异常大请求

/* ==================== 轻量 .env.local 解析（不依赖 dotenv / Node 版本特性） ==================== */
function loadEnvFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // 进程已有的环境变量优先，方便用命令行临时覆盖
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile('.env.local');

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

/* ==================== 提示词：固定规则由程序附加，用户只填业务字段 ==================== */
const SYSTEM_PROMPT = `你是一位资深的电商运营文案策划，擅长把普通的商品信息写成有画面感、有吸引力的上架文案。请根据用户给出的商品信息，生成首版商品文案。

请严格返回 JSON，且只包含以下三个字段：
{
  "title": "商品标题，20-30字。结构参考：品牌/核心词 + 关键属性 + 品类或场景。要包含搜索关键词，读起来顺口有力，不要堆砌符号或滥用夸张词",
  "summary": "商品简介，2-3句。用生动但有分寸的语言，点出这件商品最值得买的一个理由，可以描绘使用时的感受或场景，让买家一眼就明白它的价值，不要写成参数的罗列",
  "selling_points": ["卖点1", "卖点2", "卖点3"]
}

写 selling_points 时的要求（重要）：
- 每条卖点要说明这项特点『能给买家带来什么好处』或『适合什么使用场景』，而不是把输入字段换个句式重复一遍；
- 反例（不要这样写）：『牛皮材质』『XX品牌手提包』『适合都市丽人』——这些等于没说；
- 三条卖点各有侧重，分别从①材质/工艺带来的体验、②外观/设计的亮点、③适用场合或搭配建议 三个角度各写一条；
- 每条 12-25 字，语气像真人导购在推荐，避免空洞的形容词堆砌（如『高端大气上档次』）。

约束：
- 不要编造价格、销量、具体功效数据、荣誉或品牌背书；
- 用户未提供的参数（如具体尺寸、颜色）不要捏造成精确事实，可以用合理的场景化描述代替；
- 信息不足时用中性、通用的表述；
- 只返回 JSON，不要输出解释文字或 Markdown 代码块。`;

function buildUserPrompt(data) {
  const lines = [
    '请根据以下商品信息生成文案：',
    `商品名称：${data.name || '（未提供）'}`,
    `商品类目：${data.category || '（未提供）'}`,
    `品牌：${data.brand || '（未提供）'}`,
    `材质：${data.material || '（未提供）'}`,
    `适用人群：${data.audience || '（未提供）'}`,
  ];
  return lines.join('\n');
}

/* ==================== 工具函数 ==================== */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** 容错解析模型返回：去掉可能的 ```json 包裹，兼容首尾空白 */
function parseModelJson(content) {
  if (!content || !content.trim()) throw new Error('模型返回内容为空');
  let text = content.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON');
  return JSON.parse(text.slice(start, end + 1));
}

/** 归一化字段，保证前端拿到稳定结构 */
function normalizeResult(obj) {
  let points = obj.selling_points;
  if (typeof points === 'string') points = [points];
  if (!Array.isArray(points)) points = [];
  points = points.map(p => String(p).trim()).filter(Boolean).slice(0, 3);
  while (points.length < 3) points.push('');
  return {
    title: String(obj.title || '').trim(),
    summary: String(obj.summary || '').trim(),
    selling_points: points,
  };
}

/* ==================== 静态托管 ==================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  // 防目录穿越：解析后的路径必须仍在 ROOT 内
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    return sendJson(res, 403, { error: '禁止访问' });
  }
  fs.readFile(full, (err, buf) => {
    if (err) return sendJson(res, 404, { error: '文件不存在' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ==================== 核心接口 ==================== */
async function handleGenerate(req, res) {
  if (!API_KEY) {
    return sendJson(res, 500, {
      error: '服务端未配置 DEEPSEEK_API_KEY',
      hint: '请在 server.js 同目录创建 .env.local 并写入 DEEPSEEK_API_KEY=你的密钥，然后重启服务',
    });
  }

  let data;
  try {
    data = await readBody(req);
  } catch (e) {
    return sendJson(res, e.status || 400, { error: e.message });
  }

  const name = String(data.name || '').trim();
  if (!name) return sendJson(res, 400, { error: '缺少必填字段：商品名称 name' });

  const payload = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(data) },
    ],
    response_format: { type: 'json_object' },
    stream: false,
    max_tokens: 1024,
  };

  try {
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    const requestId = upstream.headers.get('x-request-id') || '';
    const raw = await upstream.text();

    if (!upstream.ok) {
      let message = `AI 服务返回 ${upstream.status}`;
      try {
        const j = JSON.parse(raw);
        message = (j.error && (j.error.message || j.error.type)) || message;
      } catch (_) { /* 保留默认信息 */ }
      // 只回传必要排查信息，绝不回传请求头或密钥
      return sendJson(res, upstream.status >= 500 ? 502 : upstream.status, {
        error: message,
        request_id: requestId,
      });
    }

    const parsed = JSON.parse(raw);
    const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
    const result = normalizeResult(parseModelJson(content));
    return sendJson(res, 200, {
      ...result,
      model: MODEL,
      request_id: requestId,
    });
  } catch (e) {
    const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    console.error('[generate] 调用失败:', isTimeout ? '请求超时' : e.message);
    return sendJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? 'AI 服务请求超时，请稍后重试' : '调用 AI 服务失败，请稍后重试',
    });
  }
}

/* ==================== 路由 ==================== */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    handleGenerate(req, res);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url.pathname);
    return;
  }
  sendJson(res, 405, { error: '不支持的请求方法' });
});

server.listen(PORT, () => {
  console.log(`电商素材工作台已启动: http://localhost:${PORT}`);
  console.log(`模型: ${MODEL}`);
  console.log(API_KEY ? 'API Key: 已读取' : 'API Key: 未配置（请创建 .env.local）');
});
