/**
 * dsh-dfy-qq · 内置 OneBot 11 通道
 *
 * 让 dsh-dfy-qq 自己接 NapCat / LLOneBot / Lagrange，不再依赖 dsh-onebot-qq。
 * 只做「能用」的那一层：反向 WS 收消息、每个会话一个 agent、回消息、补表情。
 *
 *   NapCat（或任意 OneBot 11 实现）──反向 WS──▶ 本文件起的 :6700/onebot/v11/ws
 *                                                         │
 *                                            ctx.agents.create / followup
 *                                                         │
 * 本文件 ──action: send_group_msg / send_private_msg──▶ NapCat ──▶ QQ
 *
 * 依赖的宿主服务：ctx.agents、ctx.get('agentDefaultModel')（可缺省）、
 * '@deepseek-ai/dsh-llm' 的 createUserMessage（可缺省，缺了就退化成最小消息体）。
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 4 * 1024 * 1024;

let createUserMessage = null;
try {
  ({ createUserMessage } = await import('@deepseek-ai/dsh-llm'));
} catch {
  /* 宿主没暴露就用最小消息体：{ content:[{type:'text',text}], source:{kind} } */
}

// ------------------------------------------------------------------ WebSocket
function acceptKey(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * 把 socket 的字节流解成 WebSocket 消息。只支持「服务端收客户端帧」这一半，
 * 够 OneBot 反向 WS 用；不处理扩展位。
 */
function attachFrames(socket, { onText, onClose }) {
  let buf = Buffer.alloc(0);
  let frags = [];
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_FRAME) {
        socket.destroy();
        return;
      }
      let mask = null;
      if (masked) {
        if (buf.length < off + 4) return;
        mask = buf.subarray(off, off + 4);
        off += 4;
      }
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + len);

      if (opcode === 0x8) {
        try {
          socket.write(encodeFrame(0x8, Buffer.alloc(0)));
        } catch {
          /* ignore */
        }
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        try {
          socket.write(encodeFrame(0xa, payload));
        } catch {
          /* ignore */
        }
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        frags.push(payload);
        if (!fin) continue;
        const whole = Buffer.concat(frags);
        frags = [];
        if (opcode === 0x2) continue;
        onText(whole.toString('utf8'));
        continue;
      }
    }
  });
  socket.on('close', () => onClose?.());
  socket.on('error', () => onClose?.());
}

// ------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clockText(at = Date.now()) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

/** OneBot11 的 message 段数组 → 纯文本；图片/语音留占位符，表情包别当指令看。 */
export function segmentsToText(message, raw) {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return String(raw || '');
  const out = [];
  for (const seg of message) {
    const type = seg?.type;
    if (type === 'text') out.push(seg.data?.text ?? '');
    else if (type === 'image') out.push('[图片]');
    else if (type === 'face') out.push('[表情]');
    else if (type === 'at') {
      const qq = String(seg.data?.qq ?? '');
      if (qq === 'all') out.push('@全体成员');
      else if (qq) out.push('@' + qq);
    } else if (type === 'reply') continue;
    else if (type === 'record') out.push('[语音]');
    else if (type === 'video') out.push('[视频]');
  }
  const text = out.join('').trim();
  return text || String(raw || '').trim();
}

/** 按字数上限把一段话切成 2~3 段去发；优先在句号/问号/换行处断。 */
export function splitText(text, limit) {
  const src = String(text || '').trim();
  if (!limit || limit <= 0 || src.length <= limit) return src ? [src] : [];
  const out = [];
  let rest = src;
  const breaks = /[。！？!?；;\n]/;
  while (rest.length > limit) {
    let cut = -1;
    for (let i = limit; i >= Math.floor(limit * 0.4); i--) {
      if (breaks.test(rest[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
    if (out.length >= 6) break;
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

// ------------------------------------------------------------------ channel
/**
 * @param {object} opts
 * @param {object} opts.ctx           宿主 cordis ctx
 * @param {object} opts.cfg           插件配置（活对象，每次读最新值）
 * @param {string} opts.stateDir      状态目录
 * @param {string} opts.workspace     工作区
 * @param {(level:string,msg:string)=>void} [opts.log]
 * @param {(p:object)=>void} [opts.rememberInbound]
 * @param {()=>{file:string}|null} [opts.drawEmoji]
 */
export function createChannel(opts) {
  const { ctx, cfg } = opts;
  const log = opts.log || (() => {});
  const workspace = resolve(opts.workspace || process.cwd());
  const statePath = join(opts.stateDir, 'qq-channel.json');

  const state = (() => {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      return { chats: {} };
    }
  })();
  if (!state.chats) state.chats = {};

  const saveState = () => {
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      log('warn', '写 qq-channel.json 失败：' + (e?.message ?? e));
    }
  };

  let server = null;
  let running = false;
  let lastError = '';
  const sockets = new Set();
  const chats = new Map();
  const eventSeen = Object.create(null); // chatId -> runtime record
  const pendingActions = new Map();
  let seq = 0;
  let lastEventAt = 0;
  let lastEventSummary = '';
  let inboundCount = 0;
  let outboundCount = 0;
  let taskTimer = null;
  let lastTaskAt = 0;
  if (!state.tasks) state.tasks = {};

  const botQQ = () => String(cfg.qqSelfQQ || '').trim();
  const groupAllow = () => {
    const raw = Array.isArray(cfg.qqGroups) ? cfg.qqGroups : String(cfg.qqGroups || '').split(/[\s,，;；]+/);
    return raw.map((s) => String(s).trim()).filter(Boolean);
  };
  const accessToken = () => String(cfg.qqAccessToken || '').trim();

  // ---- NapCat 守护：断线自动拉起 + 登录态探测 ----
  let monitorTimer = null;
  let noSocketSince = Date.now();
  let loginInfo = { ok: false, at: 0, uin: '', nickname: '' };
  const launcher = { spawned: 0, lastSpawnAt: 0, lastError: '' };

  const napcatBat = () => String(cfg.qqNapcatBat || '').trim();
  const napcatUin = () => String(cfg.qqNapcatUin || cfg.qqSelfQQ || '').trim();

  function launchNapcat() {
    const bat = napcatBat();
    if (!bat) return { ok: false, error: '还没填 NapCat 启动脚本路径' };
    if (!existsSync(bat)) return { ok: false, error: '找不到：' + bat };
    const now = Date.now();
    if (now - launcher.lastSpawnAt < 30000) return { ok: false, error: '刚拉起过，再等一会儿' };
    launcher.lastSpawnAt = now;
    launcher.spawned += 1;
    try {
      const uin = napcatUin();
      const child = spawn(bat, uin ? ['-q', uin] : [], {
        cwd: dirname(bat),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: process.platform === 'win32',
      });
      child.on('error', (e) => {
        launcher.lastError = String(e?.message ?? e);
      });
      child.unref();
      log('info', '已拉起 NapCat：' + bat + (uin ? ' -q ' + uin : ''));
      return { ok: true };
    } catch (e) {
      launcher.lastError = String(e?.message ?? e);
      return { ok: false, error: launcher.lastError };
    }
  }

  async function probeLogin() {
    if (sockets.size === 0) return;
    try {
      const info = await callAction('get_login_info', {}, 8000);
      const d = info?.data || info || {};
      loginInfo = {
        ok: true,
        at: Date.now(),
        uin: String(d.user_id || d.userId || ''),
        nickname: String(d.nickname || ''),
      };
    } catch {
      loginInfo = { ...loginInfo, ok: false, at: Date.now() };
    }
  }

  function watchNapcat() {
    if (sockets.size > 0) {
      noSocketSince = 0;
      return;
    }
    if (!noSocketSince) noSocketSince = Date.now();
    if (!cfg.qqChannelAutoLaunch) return;
    if (Date.now() - noSocketSince < 45000) return;
    launchNapcat();
    noSocketSince = Date.now();
  }

  function broadcast(obj) {
    const frame = encodeFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
    for (const s of sockets) {
      try {
        s.write(frame);
      } catch {
        /* ignore */
      }
    }
  }

  function callAction(action, params, timeoutMs = 20000) {
    if (sockets.size === 0) return Promise.reject(new Error('OneBot 还没连上来'));
    const echo = 'dfy-' + ++seq;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pendingActions.delete(echo);
        rej(new Error('OneBot 动作超时：' + action));
      }, timeoutMs);
      pendingActions.set(echo, { res, rej, timer });
      broadcast({ action, params, echo });
    });
  }

  function agentFor() {
    try {
      return ctx.get?.('agents') || null;
    } catch {
      return null;
    }
  }

  function defaultModel() {
    try {
      const svc = ctx.get?.('agentDefaultModel');
      return svc?.currentSelection?.();
    } catch {
      return undefined;
    }
  }

  async function ensureChat(chatId) {
    let rec = chats.get(chatId);
    if (rec?.agent) return rec;
    const agents = agentFor();
    if (!agents) throw new Error('宿主没提供 agents 服务，没法建会话');
    const saved = state.chats[chatId];
    // 会话 id 前缀可配：默认 onebot-，直接对上旧 dsh-onebot-qq 的会话（历史全在），
    // 这样"大肥鱼二号"还是原来那只，不是新开的一只。
    const prefix = String(cfg.qqSessionPrefix || 'onebot-').trim() || 'onebot-';
    const want = prefix + chatId.replace(/[^A-Za-z0-9-]/g, '-');
    // 早期版本用过 dfyqq- 前缀，那些空会话没人要——直接换回统一前缀，别把新老割成两只。
    const migrated = saved?.sessionId && !String(saved.sessionId).startsWith('dfyqq-');
    const baseId = (migrated ? saved.sessionId : want);
    const selection = defaultModel();
    const agentOptions = selection ? { provider: selection.provider, model: selection.model } : {};
    const meta = { cwd: String(cfg.qqCwd || '').trim() ? resolve(workspace, cfg.qqCwd) : workspace };
    let handle;
    try {
      handle = await agents.create({ sessionId: baseId, meta, agentOptions });
    } catch (e) {
      const alt = baseId + '-' + Date.now().toString(36);
      log('warn', '建会话失败（' + (e?.message ?? e) + '），换 id 重试：' + alt);
      handle = await agents.create({ sessionId: alt, meta, agentOptions });
    }
    await handle.agent?.whenIdle?.();
    rec = {
      chatId,
      sessionId: handle.agent?.session?.id || baseId,
      agent: handle.agent,
      dispose: handle.dispose,
      busy: false,
      queue: [],
      collecting: [],
      lastHandledId: '',
      lastAt: Date.now(),
    };
    chats.set(chatId, rec);
    state.chats[chatId] = { sessionId: rec.sessionId, at: Date.now() };
    saveState();
    log('info', 'QQ 会话就绪：' + chatId + ' → ' + rec.sessionId);
    return rec;
  }

  function onSessionEvent(session, event) {
    try {
      if (!event) return;
      const type = event.type;
      if (type) eventSeen[type] = (eventSeen[type] || 0) + 1;
      if (type !== 'assistant/message') return;
      const msg = event.data?.message;
      if (!msg) return;
      const rec = [...chats.values()].find((c) => c.sessionId === session?.id);
      if (!rec) return;
      if (msg.id && msg.id === rec.lastHandledId) return;
      if (msg.id) rec.lastHandledId = msg.id;
      const text = (msg.content || [])
        .filter((b) => b?.type === 'text')
        .map((b) => b.text || '')
        .join('');
      if (text.trim()) rec.collecting.push(text.trim());
    } catch (e) {
      log('warn', '收模型输出出错：' + (e?.message ?? e));
    }
  }

  function makeUserMessage(text) {
    if (createUserMessage) {
      try {
        return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-dfy-qq' } });
      } catch {
        /* 退回最小结构 */
      }
    }
    // 宿主包里拿不到 @deepseek-ai/dsh-llm（插件目录不解析宿主的 node_modules），
    // 这里按 llm message 的形状自己造：必须有 role 和 id，缺了 followup 会被静默丢掉。
    const id = globalThis.crypto?.randomUUID?.() || ('fq-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2));
    return Object.freeze({
      id,
      role: 'user',
      content: Object.freeze([Object.freeze({ type: 'text', text })]),
      source: Object.freeze({ kind: 'plugin:dsh-dfy-qq' }),
    });
  }

  async function sendSegments(chatId, segments) {
    const isGroup = chatId.startsWith('group-');
    const target = chatId.replace(/^(group|private)-/, '');
    let msgId = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      try {
        if (isGroup) {
          await callAction('send_group_msg', { group_id: Number(target), message: [seg] });
        } else {
          await callAction('send_private_msg', { user_id: Number(target), message: [seg] });
        }
        outboundCount++;
        msgId = Date.now();
      } catch (e) {
        log('warn', '发消息失败：' + (e?.message ?? e));
        break;
      }
      if (i < segments.length - 1) await sleep(420);
    }
    return msgId;
  }

  /** 定时任务：一行一条 —— `HH:MM | 群号 | 主题`（私聊写 private-QQ号） */
  function parseTasks() {
    const out = [];
    const lines = String(cfg.qqTasks || '').split(String.fromCharCode(10));
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const parts = t.split('|').map((x) => x.trim());
      if (parts.length < 3) continue;
      const m = /^(\d{1,2}):(\d{2})$/.exec(parts[0]);
      if (!m) continue;
      const hh = String(Number(m[1])).padStart(2, '0');
      if (Number(hh) > 23 || Number(m[2]) > 59) continue;
      out.push({ at: hh + ':' + m[2], target: parts[1], topic: parts.slice(2).join(' | ') });
    }
    return out;
  }

  function chatIdOf(target) {
    const raw = String(target || '').trim();
    if (/^private[-:]/.test(raw)) return 'private-' + raw.replace(/^private[-:]/, '');
    const digits = raw.replace(/\D/g, '');
    return digits ? 'group-' + digits : '';
  }

  async function runTask(task) {
    const chatId = chatIdOf(task.target);
    if (!chatId) return;
    if (sockets.size === 0) {
      log('warn', '定时任务跳过（OneBot 没连）：' + task.at + ' ' + task.target);
      return;
    }
    const rec = await ensureChat(chatId);
    try {
      await rec.agent.whenIdle?.();
    } catch {
      /* ignore */
    }
    rec.collecting = [];
    rec.agent.followup(
      makeUserMessage(
        `[定时任务 ${task.at}] 到点了，自己主动开一句，主题：${task.topic}。用你的口气，别提这是定时任务。`,
      ),
    );
    try {
      await rec.agent.whenIdle?.();
    } catch {
      /* ignore */
    }
    const reply = rec.collecting.join(String.fromCharCode(10)).trim();
    rec.collecting = [];
    lastTaskAt = Date.now();
    if (!reply) {
      log('warn', '定时任务没有产出：' + task.at + ' ' + task.target);
      return;
    }
    const parts = splitText(reply, Number(cfg.replyMaxChars) || 0);
    await sendSegments(
      chatId,
      parts.map((t) => ({ type: 'text', data: { text: t } })),
    );
    log('info', '定时任务已发：' + task.at + ' ' + chatId + ' ' + task.topic);
  }

  function tickTasks() {
    if (!running) return;
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const hhmm = p2(now.getHours()) + ':' + p2(now.getMinutes());
    const day = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
    let dirty = false;
    for (const task of parseTasks()) {
      if (task.at !== hhmm) continue;
      const key = day + ' ' + task.at + ' ' + task.target;
      if (state.tasks[key]) continue;
      state.tasks[key] = Date.now();
      dirty = true;
      void runTask(task).catch((e) => log('warn', '定时任务失败：' + (e?.message ?? e)));
    }
    if (dirty) {
      // 只留最近 200 条记录，别把状态文件养肥
      const keys = Object.keys(state.tasks);
      if (keys.length > 200) {
        for (const k of keys.slice(0, keys.length - 200)) delete state.tasks[k];
      }
      saveState();
    }
  }

  async function pump(rec) {
    if (rec.busy) return;
    rec.busy = true;
    try {
      while (rec.queue.length) {
        const item = rec.queue.shift();
        rec.collecting = [];
        const line = `[${clockText(item.at)} ${item.nickname || item.uid || '群友'}${item.uid ? '(' + item.uid + ')' : ''}] ${item.text}`;
        try {
          await rec.agent.whenIdle?.();
        } catch {
          /* ignore */
        }
        try {
          rec.agent.followup(makeUserMessage(line));
        } catch (e) {
          log('warn', '投递失败：' + (e?.message ?? e));
          continue;
        }
        try {
          await rec.agent.whenIdle?.();
        } catch (e) {
          log('warn', '等待回合结束失败：' + (e?.message ?? e));
        }
        const reply = rec.collecting.join('\n').trim();
        rec.collecting = [];
        rec.lastAt = Date.now();
        if (!reply) {
          log('info', '这一轮模型没说话（' + rec.chatId + '）');
          continue;
        }
        const limit = Number(cfg.replyMaxChars) || 0;
        const parts = splitText(reply, limit);
        await sendSegments(
          rec.chatId,
          parts.map((t) => ({ type: 'text', data: { text: t } })),
        );
        // 表情包：插件自己的骰子，掷到了就补一张
        try {
          const drawn = opts.drawEmoji?.();
          if (drawn?.file) {
            await sleep(260);
            const uri = 'file:///' + String(drawn.file).replace(/\\/g, '/').replace(/^\/+/, '');
            await sendSegments(rec.chatId, [{ type: 'image', data: { file: uri } }]);
          }
        } catch (e) {
          log('warn', '发表情失败：' + (e?.message ?? e));
        }
      }
    } finally {
      rec.busy = false;
    }
  }

  function enqueue(rec, item) {
    rec.queue.push(item);
    if (rec.queue.length > 8) rec.queue.splice(0, rec.queue.length - 8);
    void pump(rec);
  }

  function handleEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.post_type === 'meta_event') return;
    if (ev.post_type !== 'message') return;
    const type = ev.message_type;
    const uid = String(ev.user_id ?? '');
    const self = String(ev.self_id ?? botQQ() ?? '');
    if (!uid) return;
    if (self && uid === self) return;
    if (botQQ() && uid === botQQ()) return;
    let chatId;
    if (type === 'group') {
      const gid = String(ev.group_id ?? '');
      if (!gid) return;
      const allow = groupAllow();
      if (allow.length && !allow.includes(gid)) return;
      chatId = 'group-' + gid;
    } else if (type === 'private') {
      chatId = 'private-' + uid;
    } else {
      return;
    }
    const text = segmentsToText(ev.message, ev.raw_message);
    if (!text) return;
    const nickname = String(ev.sender?.card || ev.sender?.nickname || uid);
    inboundCount++;
    lastEventAt = Date.now();
    lastEventSummary = chatId + ' ' + nickname + '：' + text.slice(0, 60);
    try {
      opts.rememberInbound?.({ account: uid, nickname, chatId, text, at: Date.now() });
    } catch {
      /* ignore */
    }
    void ensureChat(chatId)
      .then((rec) => enqueue(rec, { text, nickname, uid, at: Date.now() }))
      .catch((e) => log('warn', '处理消息失败：' + (e?.message ?? e)));
  }

  function onClientMessage(socket, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data && typeof data.echo !== 'undefined' && (data.status === 'ok' || data.retcode !== undefined)) {
      const p = pendingActions.get(String(data.echo));
      if (p) {
        clearTimeout(p.timer);
        pendingActions.delete(String(data.echo));
        if (data.status === 'failed' || (data.retcode !== undefined && data.retcode !== 0)) {
          p.rej(new Error('OneBot 返回失败：' + (data.wording || data.message || data.retcode)));
        } else {
          p.res(data.data);
        }
      }
      return;
    }
    handleEvent(data);
  }

  function start() {
    if (running) return Promise.resolve({ ok: true, port: Number(cfg.qqWsPort) || 6700 });
    const port = Number(cfg.qqWsPort) || 6700;
    const host = String(cfg.qqHost || '127.0.0.1').trim() || '127.0.0.1';
    return new Promise((res, rej) => {
      const srv = createServer((req, resp) => {
        // 顺手支持 OneBot 11 的 HTTP 上报（可选，NapCat 里配 http 上报时用）
        if (req.method === 'POST' && (req.url || '').startsWith('/onebot/v11/http')) {
          let body = '';
          req.on('data', (c) => {
            body += c;
            if (body.length > 2 * 1024 * 1024) req.destroy();
          });
          req.on('end', () => {
            try {
              const ev = JSON.parse(body || '{}');
              handleEvent(ev);
              resp.writeHead(204).end();
            } catch {
              resp.writeHead(400).end();
            }
          });
          return;
        }
        if ((req.url || '').startsWith('/onebot/v11/ws') === false) {
          resp.writeHead(404).end('dsh-dfy-qq onebot channel');
          return;
        }
        const key = req.headers['sec-websocket-key'];
        if (!key) {
          resp.writeHead(400).end('need websocket');
          return;
        }
        const tok = accessToken();
        if (tok) {
          const url = new URL(req.url, 'http://127.0.0.1');
          const got = url.searchParams.get('access_token') || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
          if (got !== tok) {
            resp.writeHead(403).end('bad token');
            return;
          }
        }
        req.socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: ' +
            acceptKey(String(key)) +
            '\r\n\r\n',
        );
        const socket = req.socket;
        sockets.add(socket);
        log('info', 'OneBot 已连接：' + (req.socket.remoteAddress || '?'));
        attachFrames(socket, {
          onText: (t) => onClientMessage(socket, t),
          onClose: () => {
            sockets.delete(socket);
            log('info', 'OneBot 断开');
          },
        });
      });
      srv.on('error', (e) => {
        lastError = '监听 ' + host + ':' + port + ' 失败：' + (e?.message ?? e);
        running = false;
        rej(e);
      });
      srv.listen(port, host, () => {
        server = srv;
        running = true;
        lastError = '';
        log('info', 'OneBot 反向 WS 已监听 ws://' + host + ':' + port + '/onebot/v11/ws');
        if (!taskTimer) taskTimer = setInterval(tickTasks, 20000);
        if (!monitorTimer) {
          monitorTimer = setInterval(() => {
            watchNapcat();
            void probeLogin();
          }, 20000);
        }
        void probeLogin();
        tickTasks();
        res({ ok: true, port, host });
      });
    });
  }

  async function stop() {
    running = false;
    if (taskTimer) {
      clearInterval(taskTimer);
      taskTimer = null;
    }
    if (monitorTimer) {
      clearInterval(monitorTimer);
      monitorTimer = null;
    }
    for (const p of pendingActions.values()) {
      clearTimeout(p.timer);
      try {
        p.rej(new Error('通道已停止'));
      } catch {
        /* ignore */
      }
    }
    pendingActions.clear();
    for (const s of sockets) {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
    }
    sockets.clear();
    for (const rec of chats.values()) {
      try {
        rec.dispose?.();
      } catch {
        /* ignore */
      }
    }
    chats.clear();
    await new Promise((res) => {
      if (!server) return res();
      try {
        server.close(() => res());
      } catch {
        res();
      }
      setTimeout(res, 800);
    });
    server = null;
  }

  function status() {
    return {
      enabled: Boolean(cfg.qqEnabled),
      running,
      port: Number(cfg.qqWsPort) || 6700,
      host: String(cfg.qqHost || '127.0.0.1'),
      path: '/onebot/v11/ws',
      tokenRequired: Boolean(accessToken()),
      connected: sockets.size,
      chats: [...chats.values()].map((c) => ({
        chatId: c.chatId,
        sessionId: c.sessionId,
        busy: c.busy,
        queued: c.queue.length,
        lastAt: c.lastAt,
      })),
      inboundCount,
      outboundCount,
      eventSeen: Object.assign({}, eventSeen),
      lastEventAt,
      lastEventSummary,
      lastError,
      login: loginInfo,
      launcher: { ...launcher, bat: napcatBat(), uin: napcatUin() },
      autoLaunch: Boolean(cfg.qqChannelAutoLaunch),
      tasks: parseTasks(),
      lastTaskAt,
      taskRuns: Object.keys(state.tasks || {}).length,
      workspace,
      statePath,
    };
  }

  const unsubscribe = typeof ctx?.on === 'function' ? ctx.on('session/event', onSessionEvent) : undefined;

  return {
    start,
    stop,
    launch: launchNapcat,
    status,
    handleEvent,
    splitText,
    dispose: () => {
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
      return stop();
    },
  };
}
