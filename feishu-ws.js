/**
 * 飞书「长连接接收事件」Worker（官方推荐）
 * — 本机/VPS 出站连飞书，无需公网 Request URL，绕过 Vercel 3s 超时
 *
 * 用法：
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx npm run feishu:ws
 *
 * 飞书后台：事件与回调 → 订阅方式选「使用长连接接收事件」→ 先本进程连上再保存
 */
const path = require('path');
const fs = require('fs');

(function loadLocalEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i <= 0) continue;
      const key = trimmed.slice(0, i).trim();
      let val = trimmed.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
})();

const Lark = require('@larksuiteoapi/node-sdk');
const { handleFeishuHttp } = require('./feishu-event-http');

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;

if (!appId || !appSecret) {
  console.error('[feishu-ws] 缺少 FEISHU_APP_ID / FEISHU_APP_SECRET');
  console.error('  写入 .env 或在命令行传入后再启动。');
  process.exit(1);
}

const wsClient = new Lark.WSClient({
  appId,
  appSecret,
  loggerLevel: Lark.LoggerLevel.info
});

async function onReceiveMessage(data) {
  const body = {
    header: { event_type: 'im.message.receive_v1' },
    event: data
  };
  try {
    const result = await handleFeishuHttp(body);
    console.log('[feishu-ws] handled', result?.json?.action || result?.json?.ignored || 'ok');
  } catch (e) {
    console.error('[feishu-ws] handler error', e.message);
  }
}

console.log('[feishu-ws] connecting… appId=', appId.slice(0, 8) + '…');
console.log('[feishu-ws] 连上后：飞书控制台 → 事件订阅 →「使用长连接接收事件」→ 保存');
console.log('[feishu-ws] 并添加事件：im.message.receive_v1');

wsClient.start({
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': onReceiveMessage
  })
});

process.on('SIGINT', () => {
  console.log('[feishu-ws] shutdown');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[feishu-ws] shutdown');
  process.exit(0);
});
