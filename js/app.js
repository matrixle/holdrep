/* Hold Rep 主程序：页面切换、摄像头、推理循环、结果 / 历史 / 报表 */
(() => {
  'use strict';
  const C = HR_CONFIG, D = HR_DET, DB = HR_DB;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const MODE_NAME = { hang: 'Dead Hang 悬垂', pullup: '引体向上' };
  const cam = $('#cam'), overlay = $('#overlay');

  /* ---------- 工具 ---------- */
  const show = n => $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + n));
  const pad = n => String(n).padStart(2, '0');
  function fmt(ms) { // m:ss.t
    const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60);
    const r = Math.floor((s - m * 60) * 10) / 10;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }
  const fmtBig = ms => { // iOS 秒表样式 mm:ss.cc
    const cs = Math.floor(Math.max(0, ms) / 10);
    return pad(Math.floor(cs / 6000)) + ':' + pad(Math.floor(cs / 100) % 60) + '.' + pad(cs % 100);
  };
  function fmtLong(ms) { // 累计时长：h m s
    const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return h ? `${h}h ${pad(m)}m` : m ? `${m}m ${pad(s % 60)}s` : `${s}s`;
  }
  const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  /* ---------- 训练状态 ---------- */
  const T = { on: false, mode: null, phase: 'idle', det: null, t0: 0, startedAt: 0, model: null, pose: null,
    stream: null, raf: 0, busy: false, last: 0, wl: null };
  let actx;
  function beep() {
    try {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.12);
    } catch (e) {}
  }

  const MODEL_KEY = 'hr_model';
  const getModelId = () => { try { return localStorage.getItem(MODEL_KEY) || 'lightning'; } catch (e) { return 'lightning'; } };
  const setModelId = id => { try { localStorage.setItem(MODEL_KEY, id); } catch (e) {} };
  const modelLabel = id => (HR_MODELS.list.find(m => m.id === id) || HR_MODELS.list[0]).label;

  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const e = new Error('insecure'); e.name = 'Insecure'; throw e;
    }
    T.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    cam.srcObject = T.stream;
    cam.muted = true; cam.setAttribute('playsinline', '');
    // iOS Safari 上 loadedmetadata 可能要 play() 之后才触发，所以先 play，再轮询 videoWidth（最多 5s）
    cam.play().catch(() => {});
    for (let i = 0; i < 100 && !(cam.videoWidth && cam.readyState >= 2); i++) await new Promise(r => setTimeout(r, 50));
    if (!cam.videoWidth) throw new Error('摄像头画面未就绪');
  }
  function stopCamera() {
    if (T.stream) T.stream.getTracks().forEach(t => t.stop());
    T.stream = null; cam.srcObject = null;
  }
  async function lockScreen() { try { T.wl = await navigator.wakeLock.request('screen'); } catch (e) {} }
  function unlockScreen() { try { T.wl && T.wl.release(); } catch (e) {} T.wl = null; }

  function setMsg(html, actions) {
    const el = $('#trainMsg');
    if (!html) { el.hidden = true; return; }
    el.hidden = false; el.innerHTML = `<div>${html}</div>`;
    (actions || []).forEach(([label, fn]) => {
      const b = document.createElement('button'); b.textContent = label; b.onclick = fn; el.appendChild(b);
    });
  }

  async function enterTrain(mode) {
    Object.assign(T, { mode, phase: 'idle', pose: null, on: false, mdl: getModelId(), ms: 0 });
    T.det = mode === 'hang' ? new D.HangDetector() : new D.PullupDetector(beep);
    show('train'); applyBig();
    $('#hudHang').style.display = mode === 'hang' ? '' : 'none';
    $('#hudPull').style.display = mode === 'pullup' ? '' : 'none';
    T.init = { t0: performance.now(), cam: false, mdl: false, tick: 0 };
    clearInterval(T.initTimer);
    T.initTimer = setInterval(() => { T.init.tick++; initMsg(); render(); }, 200); // 转圈 + 秒数；若不再变化即为假死
    updateButtons(); initMsg(); render();
    try {
      // getUserMedia 紧跟点击手势发起，满足 iOS 权限弹窗要求
      T.mdl = getModelId();
      const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + '超时' + (what === '模型加载' ? '（卡在：' + (HR_MODELS.stage || '未开始') + '）' : ''))), ms))]);
      const camP = withTimeout(startCamera().then(r => { T.init.cam = true; return r; }), 20000, '摄像头启动');
      const [, model] = await Promise.all([camP, withTimeout(HR_MODELS.load(T.mdl).then(r => { T.init.mdl = true; return r; }), 300000, '模型加载')]);
      T.model = model; T.ms = 0; updatePerf();
      clearInterval(T.initTimer); T.init = null;
      if (!$('#v-train').classList.contains('on')) { stopCamera(); return; }
      setMsg('');
      T.on = true; T.busy = false; T.last = 0;
      lockScreen();
      loop();
    } catch (e) {
      clearInterval(T.initTimer); T.init = null;
      stopCamera();
      let m = '启动失败：' + (e.message || e) + '<br><small style="color:#9aa4b2;text-align:left;display:block">' + HR_MODELS.log.slice(-8).join('<br>') + '</small>';
      if (e.name === 'NotAllowedError') m = '没有摄像头权限。<br>请到「设置 › Safari › 摄像头」选择「询问」或「允许」，然后重试。';
      else if (e.name === 'Insecure') m = '当前页面不是 HTTPS，浏览器禁止调用摄像头。<br>请用 HTTPS 地址打开（见 README）。';
      else if (e.name === 'NotFoundError') m = '未找到摄像头。';
      setMsg(m, [['重试', () => enterTrain(mode)], ['返回首页', leaveTrain]]);
    }
  }

  function leaveTrain() {
    clearInterval(T.initTimer); T.init = null;
    T.on = false; cancelAnimationFrame(T.raf);
    stopCamera(); unlockScreen(); setMsg('');
    show('home');
  }

  /* ---------- 推理循环 ---------- */
  function loop() {
    if (!T.on) return;
    T.raf = requestAnimationFrame(loop);
    updateNums();
    const now = performance.now();
    if (T.busy || now - T.last < C.DETECT_INTERVAL_MS || cam.readyState < 2) return;
    T.busy = true; T.last = now;
    T.model.estimate(cam).then(pose => {
      T.pose = pose; T.ms = T.ms ? T.ms * 0.8 + (performance.now() - now) * 0.2 : performance.now() - now;
      if (T.phase === 'running') T.det.update(T.pose, performance.now());
      else if (T.det.calibrate) T.det.calibrate(T.pose);
      render();
    }).catch(console.error).finally(() => { T.busy = false; });
  }

  /* ---------- 模型选择（首页）/ 训练页切换 ---------- */
  function updatePerf() { $('#perf').textContent = `${modelLabel(T.mdl)}${HR_MODELS.backend && T.mdl !== 'blaze' ? '/' + HR_MODELS.backend : ''}${T.ms ? ' · ' + Math.round(T.ms) + 'ms' : ''}${T.phase === 'idle' ? ' ⟳' : ''}`; }
  $('#perf').onclick = async () => { // 训练开始前，点一下循环切换模型，便于对比
    if (T.phase !== 'idle' || !T.on || T.switching) return;
    const L = HR_MODELS.list, next = L[(L.findIndex(m => m.id === T.mdl) + 1) % L.length].id;
    T.switching = true; $('#perf').textContent = '加载 ' + modelLabel(next) + '…';
    try { T.model = await HR_MODELS.load(next); T.mdl = next; setModelId(next); T.ms = 0; syncModelSeg(); }
    catch (e) { console.error(e); $('#perf').textContent = modelLabel(next) + ' 加载失败'; await new Promise(r => setTimeout(r, 1500)); }
    T.switching = false; updatePerf();
  };
  function syncModelSeg() { $$('#segModel button').forEach(b => b.classList.toggle('on', b.dataset.v === getModelId())); }
  $$('#segModel button').forEach(b => b.onclick = () => { setModelId(b.dataset.v); syncModelSeg(); });
  syncModelSeg();

  /* ---------- 训练页渲染 ---------- */
  const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  function initText() {
    const i = T.init, secs = Math.floor((performance.now() - i.t0) / 1000);
    return `${SPIN[i.tick % 10]} 摄像头${i.cam ? '✓' : '…'} 模型${i.mdl ? '✓' : '… ' + (HR_MODELS.stage || '')} ${secs}s`;
  }
  function initMsg() {
    setMsg(`正在初始化<br><b>${initText()}</b><br><small style="color:#9aa4b2">如弹出摄像头权限提示请选「允许」。<br>转圈和秒数在变化 = 正在加载；停止变化 = 页面卡死。<br>首次使用某个模型需要下载，网络慢时可能要几十秒，之后会缓存</small>`);
  }
  function pillState() {
    if (T.init) return ['warn', '准备中 ' + initText()];
    const present = !!D.analyze(T.pose), d = T.det;
    const gs = T.mode === 'hang' && d.groundState;
    if (T.mode === 'hang' && T.phase !== 'paused' && present && d.status !== 'hanging' && C.HANG_REQUIRE_FEET_OFF_GROUND) {
      if (gs === 'nocalib') return ['warn', '先双脚着地、双手放下站一下（校准）'];
      if (gs === 'unknown') return ['warn', '需完整拍到双脚（或双膝）以判断离地'];
    }
    if (T.phase === 'idle') return present ? ['ok', '已识别 · 点「开始」'] : ['warn', '未检测到人 · 请入镜'];
    if (T.phase === 'paused') return ['warn', '⏸ 已手动暂停'];
    if (T.mode === 'hang') {
      if (d.status === 'hanging') return ['ok', '● 悬垂计时中'];
      if (d.status === 'paused') return ['warn', '⏸ 自动暂停 · 回到悬垂继续'];
      return [present ? '' : 'warn', !present ? '未检测到人' : gs === 'onground' ? '脚还在地面 · 请离地悬垂' : '等待悬垂…'];
    }
    return ({ waiting: [present ? '' : 'warn', present ? '请回到悬垂起始位' : '未检测到人'],
      ready: ['ok', '● 起始位就绪'], pulling: ['ok', '● 动作中'],
      paused: ['warn', '⏸ 自动暂停 · 回到悬垂继续'] })[d.status];
  }
  // 大字模式开关（记住选择，默认开启）
  const getBig = () => { try { return localStorage.getItem('hr_big') !== '0'; } catch (e) { return true; } };
  let big = getBig();
  function applyBig() {
    $('#v-train').classList.toggle('big-mode', big);
    $$('#segBig button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === big));
    if (T.mode === 'pullup') { const n = String(T.det ? T.det.count : 0).length; $('#pCount').style.fontSize = big ? (n >= 3 ? '38vw' : '58vw') : ''; }
    updateNums();
  }
  function setBig(v) { big = v; try { localStorage.setItem('hr_big', v ? '1' : '0'); } catch (e) {} applyBig(); }
  $('#bigToggle').onclick = () => setBig(!big);
  $$('#segBig button').forEach(b => b.onclick = () => setBig(b.dataset.v === '1'));

  // 数字刷新：每个动画帧调用，并在两次识别之间做线性插值，让毫秒位走得顺滑
  function updateNums() {
    const d = T.det; if (!d) return;
    if (T.mode === 'hang') {
      let cur = d.cur, tot = d.totalMs;
      if (T.phase === 'running' && d.active && d.lastT != null) {
        const extra = Math.min(performance.now() - d.lastT, 300); cur += extra; tot += extra;
      }
      const f = big ? fmtBig : fmt;
      $('#hCur').textContent = f(cur); $('#hTot').textContent = f(tot);
    } else {
      $('#pCount').textContent = d.count;
      $('#pLabel').textContent = d.count ? `次数 · 第 ${d.currentGroup} 组` : '次数';
      if (big) $('#pCount').style.fontSize = String(d.count).length >= 3 ? '38vw' : '58vw';
    }
  }
  function render() {
    updateNums();
    updatePerf();
    const [cls, txt] = pillState();
    const p = $('#pill'); p.className = 'pill ' + cls; p.textContent = txt;
    drawOverlay();
  }

  function drawOverlay() {
    const dpr = window.devicePixelRatio || 1, W = overlay.clientWidth, H = overlay.clientHeight;
    if (overlay.width !== Math.round(W * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr); }
    const g = overlay.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const vw = cam.videoWidth, vh = cam.videoHeight;
    if (!C.SHOW_SKELETON || !T.pose || !vw) return;
    // object-fit: cover + 镜像 的坐标映射
    const s = Math.max(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    const P = k => ({ x: W - (ox + k.x * s), y: oy + k.y * s });
    const kps = T.pose.keypoints, ok = i => kps[i] && kps[i].score >= C.MIN_KP_SCORE;
    const good = T.phase === 'running' && (T.det.active || T.det.status === 'ready' || T.det.status === 'pulling');
    g.lineWidth = 4; g.lineCap = 'round';
    g.strokeStyle = good ? 'rgba(46,230,107,.85)' : 'rgba(255,255,255,.55)';
    [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12]].forEach(([a, b]) => {
      if (!ok(a) || !ok(b)) return;
      const A = P(kps[a]), B = P(kps[b]); g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
    });
    g.fillStyle = '#ff6a1a';
    [0, 9, 10].forEach(i => { if (!ok(i)) return; const A = P(kps[i]); g.beginPath(); g.arc(A.x, A.y, 6, 0, 7); g.fill(); });
    if (T.mode === 'pullup' && T.det.barY != null) { // 估计的单杠高度
      const y = oy + T.det.barY * s;
      g.setLineDash([10, 8]); g.strokeStyle = 'rgba(255,106,26,.9)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
    }
  }

  function updateButtons() {
    const ph = T.phase;
    $('#btnStart').disabled = ph === 'running' || ph === 'ended';
    $('#btnStart').textContent = ph === 'paused' ? '继续' : '开始';
    $('#btnPause').disabled = ph !== 'running';
    $('#btnEnd').disabled = ph !== 'running' && ph !== 'paused';
  }

  $('#btnStart').onclick = () => {
    if (!T.on) return;
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) {}
    if (T.phase === 'idle') { T.t0 = performance.now(); T.startedAt = Date.now(); }
    T.phase = 'running'; lockScreen(); updateButtons(); render();
  };
  $('#btnPause').onclick = () => { T.phase = 'paused'; T.det.interrupt(); updateButtons(); render(); };
  $('#btnEnd').onclick = endSession;
  $('#btnBack').onclick = () => {
    if (T.phase === 'running' || T.phase === 'paused') {
      const p = $('#pill'); p.className = 'pill bad'; p.textContent = '请先点「结束」'; return;
    }
    leaveTrain();
  };
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !T.on) return;
    lockScreen();
    const tr = T.stream && T.stream.getVideoTracks()[0];
    if (!tr || tr.readyState === 'ended') { try { await startCamera(); } catch (e) {} } else cam.play().catch(() => {});
  });

  async function endSession() {
    if (T.phase !== 'running' && T.phase !== 'paused') return;
    const now = performance.now();
    T.phase = 'ended';
    const result = T.det.finish(T.t0);
    const s = { mode: T.mode, startedAt: T.startedAt, endedAt: Date.now(), durationMs: Math.round(now - T.t0), result };
    const empty = T.mode === 'hang' ? result.count === 0 : result.total === 0;
    T.on = false; cancelAnimationFrame(T.raf); stopCamera(); unlockScreen();
    let saved = false;
    if (!empty) { try { s.id = await DB.add(s); saved = true; } catch (e) { console.error(e); } }
    showResult(s, { fresh: true, saved, empty });
  }

  /* ---------- 结果 / 详情 ---------- */
  const stat = (k, v, cls = '') => `<div class="stat ${cls}"><small>${k}</small><b>${v}</b></div>`;
  const rows = (title, items) => `<div class="list"><h3>${title}</h3>${items.map(([a, b]) => `<div class="li"><span>${a}</span><span>${b}</span></div>`).join('')}</div>`;

  function detailHTML(s) {
    const r = s.result;
    let h = `<p class="hint" style="margin-top:0">${fmtDate(s.startedAt)} · 本轮用时 ${fmtLong(s.durationMs)}</p><div class="stats">`;
    if (s.mode === 'hang') {
      h += stat('总悬挂时长', fmt(r.totalMs), 'hl') + stat('悬挂段数', r.count) + stat('中断次数', r.interruptions) +
        stat('平均单次', fmt(r.avgMs)) + stat('最长单次', fmt(r.maxMs)) + '</div>';
      h += rows('每段悬挂（按时间顺序）', r.segments.map((x, i) => [`第 ${i + 1} 段 · +${fmt(x.offsetMs).replace(/\.\d$/, '')}`, fmt(x.ms)]));
    } else {
      const best = r.groups.length ? Math.max(...r.groups) : 0;
      h += stat('总次数', r.total, 'hl') + stat('组数', r.groups.length) + stat('最多一组', best) + '</div>';
      h += rows('每组次数', r.groups.map((n, i) => [`第 ${i + 1} 组`, n + ' 次']));
    }
    return h;
  }
  const btn = (label, cls, fn, dis) => { const b = document.createElement('button'); b.className = 'abtn ' + cls; b.textContent = label; b.disabled = !!dis; b.onclick = fn; return b; };

  function showResult(s, o = {}) {
    $('#rTitle').textContent = MODE_NAME[s.mode] + (o.fresh ? ' · 本轮结果' : '');
    $('#rBody').innerHTML = o.empty ? '<p class="empty">本轮没有记录到有效数据，未保存。</p>' : detailHTML(s);
    const a = $('#rActions'); a.innerHTML = '';
    if (o.fresh) {
      a.append(
        btn(o.saved ? '✓ 已保存到历史' : '本轮无数据，未保存', '', null, true),
        btn('再来一组', 'pri', () => enterTrain(s.mode)),
        btn('返回首页', '', () => show('home')));
    } else {
      let armed = false;
      const del = btn('删除这条记录', 'bad', async () => {
        if (!armed) { armed = true; del.textContent = '再点一次确认删除'; return; }
        await DB.remove(s.id); openHistory();
      });
      a.append(del, btn('返回列表', '', openHistory));
    }
    $('#v-result').scrollTop = 0;
    show('result');
  }

  /* ---------- 历史 ---------- */
  async function openHistory() {
    const list = await DB.all(), el = $('#hList');
    el.innerHTML = list.length ? '' : '<p class="empty">还没有训练记录</p>';
    list.forEach(s => {
      const r = s.result;
      const sum = s.mode === 'hang' ? `${fmt(r.totalMs)} · ${r.count} 段` : `${r.total} 次 · ${r.groups.length} 组`;
      const b = document.createElement('button'); b.className = 'card item';
      b.innerHTML = `<span class="ico">${s.mode === 'hang' ? '⏱' : '⬆︎'}</span><span><b>${sum}</b><small>${MODE_NAME[s.mode]} · ${fmtDate(s.startedAt)}</small></span>`;
      b.onclick = () => showResult(s);
      el.appendChild(b);
    });
    show('history');
  }

  /* ---------- 报表 ---------- */
  const rep = { metric: 'hang', range: 7, list: [] };
  async function openReport() {
    rep.list = await DB.all();
    const L = rep.list, H = L.filter(s => s.mode === 'hang'), P = L.filter(s => s.mode === 'pullup');
    const max = a => a.length ? Math.max(...a) : 0;
    $('#repStats').innerHTML =
      stat('总训练次数', L.length) +
      stat('累计悬垂时长', fmtLong(H.reduce((x, s) => x + s.result.totalMs, 0))) +
      stat('累计引体次数', P.reduce((x, s) => x + s.result.total, 0)) +
      stat('最长单次悬垂', fmt(max(H.map(s => s.result.maxMs)))) +
      stat('单轮最多引体', max(P.map(s => s.result.total))) +
      stat('单组最多引体', max(P.flatMap(s => s.result.groups)));
    drawChart(); show('report');
  }
  function drawChart() {
    const n = rep.range, today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: n }, (_, i) => new Date(today.getTime() - (n - 1 - i) * 864e5));
    const vals = days.map(() => 0);
    rep.list.filter(s => s.mode === rep.metric).forEach(s => {
      const i = Math.floor((new Date(s.startedAt).setHours(0, 0, 0, 0) - days[0]) / 864e5);
      if (i >= 0 && i < n) vals[i] += rep.metric === 'hang' ? s.result.totalMs / 1000 : s.result.total;
    });
    const isHang = rep.metric === 'hang', peak = Math.max(...vals, 0);
    const div = isHang && peak >= 120 ? 60 : 1, unit = isHang ? (div === 60 ? '分钟' : '秒') : '次';
    const v = vals.map(x => x / div), top = Math.max(...v, isHang ? 1 : 3);
    const nice = Math.ceil(top * 1.15), W = 360, Hh = 200, L = 34, B = 24, Tp = 20, pw = W - L - 6, ph = Hh - B - Tp, bw = pw / n;
    let svg = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${unit}趋势">`;
    [0, .5, 1].forEach(f => {
      const y = Tp + ph * (1 - f);
      svg += `<line x1="${L}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#262c35"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" fill="#9aa4b2" font-size="11">${+(nice * f).toFixed(1)}</text>`;
    });
    v.forEach((x, i) => {
      const h = ph * x / nice, bx = L + i * bw + bw * .15, w = bw * .7;
      if (x > 0) svg += `<rect x="${bx}" y="${Tp + ph - h}" width="${w}" height="${h}" rx="${Math.min(4, w / 2)}" fill="#ff6a1a"/>`;
      if (x > 0 && n === 7) svg += `<text x="${bx + w / 2}" y="${Tp + ph - h - 5}" text-anchor="middle" fill="#fff" font-size="11">${+x.toFixed(1)}</text>`;
      const d = days[i], lab = n === 7 ? '日一二三四五六'[d.getDay()] : ((n - 1 - i) % 5 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '');
      if (lab) svg += `<text x="${bx + w / 2}" y="${Hh - 6}" text-anchor="middle" fill="#9aa4b2" font-size="11">${lab}</text>`;
    });
    $('#chart').innerHTML = svg + '</svg>';
    const sum = v.reduce((a, b) => a + b, 0), act = v.filter(x => x > 0).length;
    $('#chartSum').textContent = `单位：${unit}/天 · 区间合计 ${+sum.toFixed(1)} ${unit} · 训练 ${act} 天`;
  }
  $$('#segMetric button, #segRange button').forEach(b => b.onclick = () => {
    b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (b.parentNode.id === 'segMetric') rep.metric = b.dataset.v; else rep.range = +b.dataset.v;
    drawChart();
  });

  /* ---------- 入口 ---------- */
  $$('.mode').forEach(b => b.onclick = () => enterTrain(b.dataset.mode));
  $$('[data-home]').forEach(b => b.onclick = () => show('home'));
  $('#goHistory').onclick = openHistory;
  $('#goReport').onclick = openReport;
  show('home'); applyBig();
  const showVer = (cache) => { $('#ver').textContent = `版本 ${HR_BUILD.version} · 更新于 ${HR_BUILD.time}` + (cache ? ` · 缓存 ${cache}` : ''); };
  showVer();
  // 当前实际生效的 Service Worker 缓存名：与版本不一致说明手机上还是旧缓存
  if (window.caches) caches.keys().then(ks => showVer(ks.filter(k => k.startsWith('holdrep-')).join(',') || '无')).catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
})();
