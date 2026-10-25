/**
 * dsh-dfy-qq —— 设置页（浏览器半端）
 *
 * 按 DSH 约定自注册：window.__ModuleLoader__.load({ id, factory })
 * 进「设置」靠 slots.inject('settings.section', ...)，label 就是左侧导航那一项。
 */
window.__ModuleLoader__.load({
  id: 'dsh-dfy-qq',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const API = '/api/dfy-qq';

    const asJson = async (res) => {
      if (res.ok) return res.json();
      const why = res.status === 401 ? '（未登录）' : res.status === 403 ? '（被拦）' : '';
      throw new Error('HTTP ' + res.status + why);
    };
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }));
    const jpost = async (p, body) =>
      asJson(
        await fetch(API + p, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        }),
      );

    const CSS = `
[data-fq]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 8px;max-width:640px;}
[data-fq-sec]{display:flex;flex-direction:column;gap:8px;}
[data-fq-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-fq-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-fq-grow]{flex:1;min-width:0;}
[data-fq-label]{font-size:13px;}
[data-fq-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-fq-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));color:inherit;}
[data-fq-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-fq-sw][data-on]{background:#3b82f6;}
[data-fq-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;display:block;}
[data-fq-sw][data-on] i{left:19px;}
[data-fq-btn]{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));color:inherit;font-size:12px;cursor:pointer;}
[data-fq-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-fq-ok]{font-size:11px;color:#22c55e;}
[data-fq-err]{font-size:11px;color:#ef4444;}
[data-fq-bar]{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 0;background:var(--dsw-alias-bg-layer-1,#17181c);border-bottom:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));}
[data-fq-dirty]{font-size:11px;color:#f59e0b;}
[data-fq-kv]{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;font-size:11px;
  color:var(--dsw-alias-label-tertiary,#9aa0a6);}
`;

    function Switch({ on, onChange, disabled }) {
      return h(
        'button',
        { 'data-fq-sw': '', 'data-on': on ? '' : undefined, disabled, onClick: () => onChange(!on) },
        h('i'),
      );
    }

    function Field({ label, note, children }) {
      return h(
        'div',
        { 'data-fq-sec': '' },
        h('div', { 'data-fq-label': '' }, label),
        children,
        note ? h('div', { 'data-fq-note': '' }, note) : null,
      );
    }

    function Panel() {
      const [st, setSt] = React.useState(null);
      const [form, setForm] = React.useState({});
      const [msg, setMsg] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [dirty, setDirty] = React.useState(false);

      const load = React.useCallback(async () => {
        try {
          const r = await jget('/status');
          setSt(r);
          setForm((prev) => ({ ...r.config, autoSpeakKeywords: (r.config.autoSpeakKeywords || []).join('、'), ...prev }));
          setDirty(false);
        } catch (e) {
          setMsg({ kind: 'err', text: '读取失败：' + String(e.message || e) });
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      const set = (k) => (e) => { setDirty(true); setForm((f) => ({ ...f, [k]: e.target.value })); };
      const setRaw = (k, v) => { setDirty(true); setForm((f) => ({ ...f, [k]: v })); };

      const save = async () => {
        setBusy(true);
        setMsg(null);
        try {
          const payload = { ...form };
          payload.emojiChance = Number(payload.emojiChance) || 0;
          payload.emojiPity = Math.max(0, Number(payload.emojiPity) || 0);
          payload.autoSpeakChance = Number(payload.autoSpeakChance) || 0;
          payload.autoSpeakCooldownMin = Math.max(0, Number(payload.autoSpeakCooldownMin) || 0);
          payload.autoSpeakKeywords = String(payload.autoSpeakKeywords || '')
            .split(/[、,，\s]+/)
            .filter(Boolean);
          if (!Array.isArray(payload.personasEnabled)) payload.personasEnabled = [];
          if (!Array.isArray(payload.personaFiles)) payload.personaFiles = [];
          payload.personaFiles = payload.personaFiles.map((x) => String(x || '').trim()).filter(Boolean);
          const r = await jpost('/config', payload);
          setSt(r);
          setDirty(false);
          setMsg({ kind: 'ok', text: '已保存到 <stateDir>/config.json' });
        } catch (e) {
          setMsg({ kind: 'err', text: '保存失败：' + String(e.message || e) });
        } finally {
          setBusy(false);
        }
      };

      if (!st) return h('div', { 'data-fq': '' }, h('div', { 'data-fq-note': '' }, '加载中…'));

      const rt = st.runtime || {};
      const checks = Array.isArray(st.checks) ? st.checks : [];
      const checkColor = (lv) => (lv === 'error' ? '#ef4444' : '#f59e0b');

      return h(
        'div',
        { 'data-fq': '' },

        h('div', { 'data-fq-bar': '' },
          h('button', { 'data-fq-btn': '', 'data-primary': '', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
          h('button', { 'data-fq-btn': '', onClick: load }, '重新读取'),
          dirty ? h('span', { 'data-fq-dirty': '' }, '● 有未保存改动') : null,
          msg ? h('span', { [msg.kind === 'ok' ? 'data-fq-ok' : 'data-fq-err']: '' }, msg.text) : null,
        ),

        checks.length > 0
          ? h('div', { 'data-fq-sec': '' },
              h('div', { 'data-fq-h': '' }, '配置体检'),
              ...checks.map((c) =>
                h('div', { 'data-fq-note': '', style: { color: checkColor(c.level) } }, (c.level === 'error' ? '✕ ' : '! ') + c.msg),
              ),
            )
          : null,

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '工作区'),
          h(Field, { label: '工作区根目录', note: '下面所有相对路径都按它解析。改了要保存，然后重启 DSH。' },
            h('input', {
              'data-fq-input': '',
              value: form.workspace || '',
              onChange: set('workspace'),
              placeholder: '例如 C:\\Users\\you\\Documents\\dsh-workspace',
            })),
          h('div', { 'data-fq-note': '' }, `当前：${rt.workspace || '（未设置，用进程目录）'}`),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '人设'),
          h(Field, { label: '人设文件（相对工作区，一行一个，按顺序拼接）', note: '例：kb/人设-蓝色大肥鱼/….txt 换行 AGENTS.md。改了要保存后重新加载。' },
            h('textarea', {
              'data-fq-input': '',
              rows: 3,
              value: (form.personaFiles || []).join('\n'),
              onChange: (e) => setRaw('personaFiles', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)),
              placeholder: 'AGENTS.md',
            })),
          h(Field, { label: '或直接写人设文本（优先于文件）' },
            h('textarea', { 'data-fq-input': '', rows: 4, value: form.personaText || '', onChange: set('personaText') })),
          h('div', { 'data-fq-note': '' }, `当前来源：${rt.personaSource} · ${rt.personaChars} 字符`),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '子人格'),
          h(Field, { label: '人格目录（相对工作区）', note: '一个 .md 一份人格；第一行 # 标题，> 简介：一句话。' },
            h('input', { 'data-fq-input': '', value: form.personasDir || '', onChange: set('personasDir'), placeholder: 'personas' })),
          h('div', { 'data-fq-row': '' },
            h(Switch, { on: form.personaAuto !== false, onChange: (v) => setRaw('personaAuto', v) }),
            h('span', { 'data-fq-label': '' }, '按语境自动挑人格'),
          ),
          h('div', { 'data-fq-note': '' },
            (rt.personas || []).length === 0
              ? `目录 ${rt.personasDir || ''} 里没有 .md`
              : `已装 ${(rt.personas || []).length} 个，勾上的才可用：`),
          ...(rt.personas || []).map((p) => {
            const picked = (form.personasEnabled || []).length === 0
              ? true
              : (form.personasEnabled || []).includes(p.file);
            return h('div', { 'data-fq-row': '' },
              h(Switch, {
                on: picked,
                onChange: (v) => {
                  const cur = (form.personasEnabled || []).length === 0
                    ? (rt.personas || []).map((x) => x.file)
                    : [...(form.personasEnabled || [])];
                  const next = v ? [...new Set([...cur, p.file])] : cur.filter((f) => f !== p.file);
                  setRaw('personasEnabled', next);
                },
              }),
              h('span', { 'data-fq-label': '' }, `${p.title}${p.summary ? ' · ' + p.summary : ''}`),
            );
          }),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '认人'),
          h(Field, { label: '群友档案路径' },
            h('input', { 'data-fq-input': '', value: form.peopleFile || '', onChange: set('peopleFile') })),
          h('div', { 'data-fq-note': '' }, `实际：${rt.peopleFile}`),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '表情包'),
          h(Field, { label: '表情包文件夹' },
            h('input', { 'data-fq-input': '', value: form.emojiDir || '', onChange: set('emojiDir'), placeholder: '留空 = <工作区>/emoji；相对路径按工作区解析' })),
          h(Field, { label: '索引文档' },
            h('input', { 'data-fq-input': '', value: form.emojiIndexFile || '', onChange: set('emojiIndexFile') })),
          h(Field, { label: `发图概率：${Math.round((Number(form.emojiChance) || 0) * 100)}%` },
            h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: form.emojiChance, onChange: set('emojiChance'), style: { width: '100%' } })),
          h(Field, { label: '大保底（连续 N 轮没发就强制发）' },
            h('input', { 'data-fq-input': '', type: 'number', min: 0, value: form.emojiPity, onChange: set('emojiPity') })),
          h('div', { 'data-fq-row': '' },
            h('span', { 'data-fq-note': '' }, `可用 ${rt.emojiCount} 张 · 已连续未发 ${rt.emojiMisses} 轮`),
            h('div', { 'data-fq-grow': '' }),
            h('button', { 'data-fq-btn': '', onClick: async () => { const r = await jpost('/emoji/rebuild'); setMsg({ kind: r.ok ? 'ok' : 'err', text: r.ok ? `索引已重建：${r.count} 张` : '重建失败' }); } }, '重建索引'),
            h('button', { 'data-fq-btn': '', onClick: async () => { await jpost('/reset-pity'); await load(); } }, '清零保底'),
          ),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, 'QQ 通道（内置 OneBot 11）'),
          h('div', { 'data-fq-row': '' },
            h(Switch, {
              on: !!(st.channel && st.channel.running),
              disabled: busy,
              onChange: async (v) => {
                setBusy(true);
                setMsg(null);
                try {
                  const r = await jpost(v ? '/channel/start' : '/channel/stop', { qqWsPort: Number(form.qqWsPort) || 6700 });
                  setSt(r);
                  setMsg(v
                    ? (r.ok === false ? { kind: 'err', text: '启动失败：' + (r.error || '未知') } : { kind: 'ok', text: '通道已启动' })
                    : { kind: 'ok', text: '通道已停止' });
                } catch (e) {
                  setMsg({ kind: 'err', text: '操作失败：' + String(e.message || e) });
                } finally {
                  setBusy(false);
                }
              },
            }),
            h('span', { 'data-fq-label': '' }, st.channel && st.channel.running ? '监听中' : '已停止'),
            h('div', { 'data-fq-grow': '' }),
            h('span', { 'data-fq-note': '' },
              st.channel
                ? `已连 ${st.channel.connected} 个 · 收 ${st.channel.inboundCount} / 发 ${st.channel.outboundCount} · 会话 ${(st.channel.chats || []).length}`
                : ''),
          ),
          st.channel
            ? h('div', { 'data-fq-note': '' },
                `WS 地址：ws://${st.channel.host}:${st.channel.port}${st.channel.path}` +
                  (st.channel.tokenRequired ? '（要 access_token）' : '（不校验 token）') +
                  (st.channel.lastEventSummary ? ` · 最近事件：${st.channel.lastEventSummary}` : '') +
                  (st.channel.lastError ? ` · 错误：${st.channel.lastError}` : ''))
            : null,
          h('div', { 'data-fq-row': '' },
            h(Field, { label: '监听端口' },
              h('input', { 'data-fq-input': '', type: 'number', min: 1, value: form.qqWsPort, onChange: set('qqWsPort') })),
            h(Field, { label: '监听地址' },
              h('input', { 'data-fq-input': '', value: form.qqHost || '', onChange: set('qqHost'), placeholder: '127.0.0.1' })),
          ),
          h(Field, { label: 'access_token（留空 = 不校验）' },
            h('input', { 'data-fq-input': '', value: form.qqAccessToken || '', onChange: set('qqAccessToken') })),
          h(Field, { label: '群白名单（逗号分隔，空 = 所有群）' },
            h('input', {
              'data-fq-input': '',
              value: Array.isArray(form.qqGroups) ? form.qqGroups.join(',') : String(form.qqGroups || ''),
              onChange: (e) => setRaw('qqGroups', e.target.value.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)),
              placeholder: '123456,789012',
            })),
          h(Field, { label: 'bot 自己的 QQ（防空回复回环）' },
            h('input', { 'data-fq-input': '', value: form.qqSelfQQ || '', onChange: set('qqSelfQQ'), placeholder: '1053187718' })),
          h(Field, { label: 'QQ 会话工作目录（相对工作区，空 = 根）' },
            h('input', { 'data-fq-input': '', value: form.qqCwd || '', onChange: set('qqCwd'), placeholder: '留空' })),
          h('div', { 'data-fq-note': '' }, 'NapCat 里配「反向 WebSocket」：ws://127.0.0.1:6700/onebot/v11/ws，token 同上。改完点顶部保存，再开关一次通道。'),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '定时任务'),
          h(Field, { label: '一行一条：HH:MM | 群号或 private-QQ | 主题', note: '# 开头的行忽略；同一分钟同目标一天只跑一次。' },
            h('textarea', {
              'data-fq-input': '',
              rows: 4,
              value: form.qqTasks || '',
              onChange: set('qqTasks'),
              placeholder: '09:00 | 123456789 | 早上问个好\n21:30 | private-934705339 | 提醒今天没写完的活',
            })),
          h('div', { 'data-fq-row': '' },
            h('button', {
              'data-fq-btn': '',
              disabled: busy,
              onClick: async () => {
                setBusy(true);
                try {
                  const r = await jpost('/channel/tasks', { qqTasks: String(form.qqTasks || '') });
                  setSt(r);
                  setMsg({ kind: 'ok', text: `定时任务已存：${(r.channel && r.channel.tasks ? r.channel.tasks.length : 0)} 条` });
                } catch (e) {
                  setMsg({ kind: 'err', text: '保存失败：' + String(e.message || e) });
                } finally {
                  setBusy(false);
                }
              },
            }, '单独保存定时任务'),
            h('span', { 'data-fq-note': '' },
              st.channel
                ? `已排 ${(st.channel.tasks || []).length} 条 · 今天已跑 ${st.channel.taskRuns || 0} 次`
                : ''),
          ),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '主动接话'),
          h('div', { 'data-fq-row': '' },
            h(Switch, { on: !!form.autoSpeakEnabled, onChange: (v) => setRaw('autoSpeakEnabled', v) }),
            h('span', { 'data-fq-label': '' }, '允许不 @ 也接话'),
          ),
          h('div', { 'data-fq-note': '' }, '通道层（onebot / im-connect）要调用 shouldSpeak 才生效；onebot 已接。'),
          h(Field, { label: `接话概率：${Math.round((Number(form.autoSpeakChance) || 0) * 100)}%` },
            h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: form.autoSpeakChance, onChange: set('autoSpeakChance'), style: { width: '100%' } })),
          h(Field, { label: '冷却（分钟）' },
            h('input', { 'data-fq-input': '', type: 'number', min: 0, value: form.autoSpeakCooldownMin, onChange: set('autoSpeakCooldownMin') })),
          h(Field, { label: '关键词（顿号/逗号分隔，命中直接接）' },
            h('input', { 'data-fq-input': '', value: form.autoSpeakKeywords || '', onChange: set('autoSpeakKeywords') })),
        ),

        h('div', { 'data-fq-sec': '' },
          h('div', { 'data-fq-h': '' }, '记忆与回复'),
          h(Field, { label: '每个会话记最近 N 条', note: '超出的自然滚掉；同时保留的会话数也有限制。' },
            h('input', { 'data-fq-input': '', type: 'number', min: 4, value: form.memoryRounds, onChange: set('memoryRounds') })),
          h(Field, { label: '同时保留几个会话' },
            h('input', { 'data-fq-input': '', type: 'number', min: 1, value: form.memoryChats, onChange: set('memoryChats') })),
          h(Field, { label: '单条回复字数上限（0 = 不限）', note: '超了就拆成 2~3 段发。' },
            h('input', { 'data-fq-input': '', type: 'number', min: 0, value: form.replyMaxChars, onChange: set('replyMaxChars') })),
          h(Field, { label: '最近多少张不重复发' },
            h('input', { 'data-fq-input': '', type: 'number', min: 0, value: form.emojiRecentSkip, onChange: set('emojiRecentSkip') })),
          h('div', { 'data-fq-note': '' }, `已记 ${rt.memoryChats || 0} 个会话 / ${rt.memoryRows || 0} 条 · 见过的号 ${rt.peopleSeen || 0} 个`),
        ),

        h('div', { 'data-fq-kv': '' },
          h('span', {}, '工作区'), h('span', {}, rt.workspace || ''),
          h('span', {}, '人格目录'), h('span', {}, rt.personasDir || ''),
          h('span', {}, '状态目录'), h('span', {}, rt.stateDir || ''),
          h('span', {}, '索引'), h('span', {}, rt.indexFile || ''),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        ctx.effect(() => () => style.remove(), 'dfy-qq: 设置页样式');

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots;
        if (!slots) return;
        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'dfy-qq', order: 35, label: '肥鱼·QQ' }, () => h(Panel)),
        );
      },
    };
  },
});
