// 偏航 AI 后端 - Cloudflare Worker 版（FastAPI main.py 的 JS 等价移植）
// 密钥仅存放在 Worker 环境变量 LLM_API_KEY 中，绝不下发前端。
// 部署：cd worker && npx wrangler deploy
// 本地冒烟测试：node test.js

const DEFAULT_LLM_BASE = 'https://api.openai-next.com/v1';
const DEFAULT_LLM_MODEL = 'deepseek-v4-flash';

// ---------- 工具 ----------

// 鲁棒解析模型输出的 JSON：兼容 markdown 代码块、前后缀杂讯（对应后端 extract_json）
function extractJson(raw) {
  if (!raw) throw new Error('模型返回为空');
  raw = String(raw).trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```[A-Za-z]*\s*/, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{.*\}/s);
    if (m) return JSON.parse(m[0]);
    throw e;
  }
}

// 统一大模型调用（对应后端 call_llm）。注意中转服务对部分模型不支持
// response_format=json_object，因此统一不传该参数，改用提示词约束 + 鲁棒解析。
async function callLlm(systemPrompt, userPrompt, env) {
  if (!env.LLM_API_KEY) throw new Error('未配置 LLM_API_KEY');
  const base = env.LLM_BASE_URL || DEFAULT_LLM_BASE;
  const resp = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.LLM_API_KEY
    },
    body: JSON.stringify({
      model: env.LLM_MODEL || DEFAULT_LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7
    })
  });
  if (!resp.ok) {
    throw new Error('LLM HTTP ' + resp.status + ': ' + (await resp.text()).slice(0, 200));
  }
  const data = await resp.json();
  const text = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('LLM 返回为空');
  return text;
}

// 确定性字符串哈希（用于 Mock 模板选择）
function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---------- 真实大模型实现（对应后端 ai_*） ----------

async function aiParsePref(userText, minutes, env) {
  const timeMap = { 30: 'short', 60: 'medium', 90: 'long' };
  const timeLevel = minutes ? (timeMap[minutes] || 'medium') : 'medium';
  const systemPrompt =
    '你是偏航App的偏好解析助手。根据用户描述，输出JSON格式的结构化参数。' +
    'time_level只能是short/medium/long；walk_intensity只能是low/mid/high；' +
    'novelty和minor_level都是0-1的数字（保留1位小数）。' +
    '只输出JSON对象本身，不要添加任何解释、标点或markdown代码块。';
  const userPrompt =
    '用户可用时间：' + (minutes || 0) + '分钟。' +
    '用户描述：' + (userText || '无') + '\n' +
    '请返回JSON：{"time_level":"...", "walk_intensity":"...", "novelty":0.x, "minor_level":0.x}';
  try {
    const result = extractJson(await callLlm(systemPrompt, userPrompt, env));
    if (!result.time_level) result.time_level = timeLevel;
    result.novelty = parseFloat(result.novelty === undefined || result.novelty === null ? 0.5 : result.novelty);
    result.minor_level = parseFloat(result.minor_level === undefined || result.minor_level === null ? 0.5 : result.minor_level);
    return result;
  } catch (e) {
    console.log('[WARN] LLM解析失败，使用默认值: ' + e.message);
    return {
      time_level: timeLevel,
      walk_intensity: 'mid',
      novelty: 0.5,
      minor_level: 0.5,
      llm_error: e.message
    };
  }
}

async function aiGetReason(pois, weather, minutes, env) {
  const names = (pois || []).map(p => p.name || '?');
  const types = (pois || []).map(p => p.type || '');
  const head = names.length ? names.join('、') : '若干地点';
  const typeSet = Array.from(new Set(types.filter(Boolean))).sort().join('、') || '各类地点';
  const systemPrompt =
    '你是偏航App的路线推荐助手。根据地点列表、天气和时长，生成一段有吸引力的路线推荐理由。' +
    '不要编造地点不存在的事实（如历史、评分等）。理由要简洁、口语化、有温度，控制在100字以内。';
  const userPrompt =
    '地点：' + head + '（' + typeSet + '），当前天气：' + (weather || '未知') +
    '，预计时长：' + minutes + '分钟。请生成推荐理由。';
  try {
    const text = await callLlm(systemPrompt, userPrompt, env);
    return { text: text.trim() };
  } catch (e) {
    console.log('[WARN] LLM生成理由失败，使用模板: ' + e.message);
    return {
      text: '这条路线串联' + names.length + '处地点：' + head + '，结合' + (weather || '当前') +
        '天气与约' + minutes + '分钟时长，带你逛平时容易忽略的街角与风景。',
      llm_error: e.message
    };
  }
}

async function aiGetIntro(name, ptype, env) {
  const systemPrompt =
    '你是偏航App的地点介绍助手。根据地点名称和类型，生成一段简短的介绍文字（50字以内）。' +
    '只描述地点本身的氛围和适合偏航的理由，不要编造历史、评分、创始人等无法从名称推断的事实。';
  const userPrompt = '地点名称：' + name + '，类型：' + (ptype || '地点') + '。请生成介绍。';
  try {
    const text = await callLlm(systemPrompt, userPrompt, env);
    return { text: text.trim() };
  } catch (e) {
    console.log('[WARN] LLM生成介绍失败，使用模板: ' + e.message);
    return {
      text: name + '是一处' + (ptype || '地点') + '，适合在偏航途中稍作停留、慢慢感受周边氛围。',
      llm_error: e.message
    };
  }
}

// ---------- Mock 实现（无密钥或未配置时自动回退，对应后端 mock_*） ----------

function mockParsePref(userText, minutes) {
  const t = (userText || '').trim();
  let timeLevel;
  if (minutes) {
    if (minutes <= 30) timeLevel = 'short';
    else if (minutes <= 60) timeLevel = 'medium';
    else timeLevel = 'long';
  } else {
    if (['近', '不远', '短', '少走'].some(w => t.includes(w))) timeLevel = 'short';
    else if (['远', '长', '多走'].some(w => t.includes(w))) timeLevel = 'long';
    else timeLevel = 'medium';
  }
  let walkIntensity = 'mid';
  if (['慢', '悠闲', '闲逛', '散步', '漫步', '轻松'].some(w => t.includes(w))) walkIntensity = 'low';
  else if (['快', '赶', '急', '效率'].some(w => t.includes(w))) walkIntensity = 'high';
  let novelty = 0.5;
  if (['小众', '冷门', '人少', '安静', '特别', '独特', '新奇'].some(w => t.includes(w))) novelty = 0.85;
  else if (['热门', '打卡', '著名', '网红', '知名'].some(w => t.includes(w))) novelty = 0.2;
  let minorLevel = 0.5;
  if (['弄堂', '小巷', '小路', '支路', '偏', '安静'].some(w => t.includes(w))) minorLevel = 0.85;
  else if (['主路', '大道', '大街', '环线'].some(w => t.includes(w))) minorLevel = 0.2;
  return {
    time_level: timeLevel,
    walk_intensity: walkIntensity,
    novelty: Math.round(novelty * 100) / 100,
    minor_level: Math.round(minorLevel * 100) / 100
  };
}

function mockGetReason(pois, weather, minutes) {
  const names = (pois || []).map(p => p.name || '?');
  const types = (pois || []).map(p => p.type || '');
  const n = names.length;
  const w = weather || '未知天气';
  const head = names.length ? names.join('、') : '若干地点';
  const typeSet = Array.from(new Set(types.filter(Boolean))).sort().join('、') || '各类地点';
  const templates = [
    '这条路线串联' + n + '处地点：' + head + '，带你逛平时容易忽略的街角与风景。',
    '结合当前' + w + '与约' + minutes + '分钟时长，' + typeSet + '混搭，兼顾新奇发现与步行舒适度。',
    '从' + (names[0] || '起点') + '出发，依次经过' + head + '，是一条“非最短但值得”的探索路线。'
  ];
  const idx = names.length ? strHash(names.join(',')) % templates.length : 0;
  return { text: templates[idx] };
}

function mockGetIntro(name, ptype) {
  const templates = [
    name + '是一处' + (ptype || '地点') + '，适合在偏航途中稍作停留、慢慢感受周边氛围。',
    '这里是' + name + '（' + (ptype || '地点') + '），漫步至此不妨放慢脚步、留意周围细节。',
    name + '，属于' + (ptype || '地点') + '类别，是这次偏航探索的一处停靠点。'
  ];
  const idx = strHash(name + ',' + ptype) % templates.length;
  return { text: templates[idx] };
}

// ---------- 路由（对应后端 FastAPI 路由） ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const json = (obj, status) =>
      new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
      });

    // 服务信息（前端启动时探测后端模式）
    if (path === '/' && request.method === 'GET') {
      return json({
        service: '偏航后端',
        mode: env.LLM_API_KEY
          ? 'Real(' + (env.LLM_MODEL || DEFAULT_LLM_MODEL) + ')'
          : 'Mock(无密钥)',
        endpoints: ['POST /api/parse_pref', 'POST /api/get_reason', 'POST /api/get_intro']
      });
    }

    if (request.method !== 'POST') return json({ error: 'Not Found' }, 404);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Bad JSON' }, 400);
    }

    try {
      if (path === '/api/parse_pref') {
        const r = env.LLM_API_KEY
          ? await aiParsePref(body.user_text || '', body.minutes, env)
          : mockParsePref(body.user_text || '', body.minutes);
        return json(r);
      }
      if (path === '/api/get_reason') {
        const r = env.LLM_API_KEY
          ? await aiGetReason(body.pois || [], body.weather || '', body.minutes || 60, env)
          : mockGetReason(body.pois || [], body.weather || '', body.minutes || 60);
        return json(r);
      }
      if (path === '/api/get_intro') {
        const r = env.LLM_API_KEY
          ? await aiGetIntro(body.name || '', body.type || '', env)
          : mockGetIntro(body.name || '', body.type || '');
        return json(r);
      }
    } catch (e) {
      return json({ error: e.message }, 500);
    }

    return json({ error: 'Not Found' }, 404);
  }
};
