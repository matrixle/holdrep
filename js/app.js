/* Hold Rep 主程序：页面切换、摄像头、推理循环、结果 / 历史 / 报表 */
(() => {
  'use strict';
  const C = HR_CONFIG, D = HR_DET, DB = HR_DB;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const MODE_NAME = { hang: 'Dead Hang 悬垂', pullup: '引体向上' };
  const cam = $('#cam'), overlay = $('#overlay');
  // 线条图标（与 App 图标同一风格：圆头粗线），颜色随 currentColor
  const svg = b => `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
  const ICON = {
    pullup: svg('<path d="M14 54H86"/><circle cx="50" cy="32" r="11" fill="currentColor" stroke="none"/><path d="M28 54A22 22 0 0 0 72 54"/>'),
    hang: svg('<circle cx="50" cy="57" r="29"/><path d="M42 16H58M50 16V28M50 57V40"/>'),
    list: svg('<path d="M34 28H82M34 50H82M34 72H82"/><circle cx="17" cy="28" r="2"/><circle cx="17" cy="50" r="2"/><circle cx="17" cy="72" r="2"/>'),
    chart: svg('<path d="M20 80V58M40 80V40M60 80V50M80 80V24"/>'),
  };
  $$('[data-ico]').forEach(e => { e.outerHTML = e.tagName === 'I' ? ICON[e.dataset.ico] : `<span class="ico">${ICON[e.dataset.ico]}</span>`; });

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
    Object.assign(T, { mode, phase: 'idle', pose: null, on: false, ms: 0 });
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
      const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + '超时' + (what === '模型加载' ? '（卡在：' + (HR_MODELS.stage || '未开始') + '）' : ''))), ms))]);
      const camP = withTimeout(startCamera().then(r => { T.init.cam = true; return r; }), 20000, '摄像头启动');
      const [, model] = await Promise.all([camP, withTimeout(HR_MODELS.load().then(r => { T.init.mdl = true; return r; }), 300000, '模型加载')]);
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

  /* ---------- 训练页顶部标签：模型 / 离地高度 / 推理耗时 ---------- */
  function updatePerf() { $('#perf').textContent = `${HR_MODELS.label.replace('BlazePose ', '')}${T.mode === 'hang' && T.det && T.det.lift != null ? ' ↑' + T.det.lift.toFixed(2) : ''}${T.ms ? ' · ' + Math.round(T.ms) + 'ms' : ''}`; }

  /* ---------- 训练页渲染 ---------- */
  const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  function initText() {
    const i = T.init, secs = Math.floor((performance.now() - i.t0) / 1000);
    return `${SPIN[i.tick % 10]} 摄像头${i.cam ? '✓' : '…'} 模型${i.mdl ? '✓' : '… ' + (HR_MODELS.stage || '')} ${secs}s`;
  }
  function initMsg() {
    setMsg(`正在初始化<br><b>${initText()}</b><br><small style="color:#9aa4b2">如弹出摄像头权限提示请选「允许」。<br>转圈和秒数在变化 = 正在加载；停止变化 = 页面卡死。<br>首次使用需要下载约 40MB 模型，网络慢时可能要几十秒，之后会缓存（更新版本不会重新下载）</small>`);
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
    g.strokeStyle = good ? 'rgba(255,94,26,.9)' : 'rgba(255,255,255,.55)';
    [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]].forEach(([a, b]) => {
      if (!ok(a) || !ok(b)) return;
      const A = P(kps[a]), B = P(kps[b]); g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
    });
    g.fillStyle = '#fff';
    [0, 9, 10, 15, 16].forEach(i => { if (!ok(i)) return; const A = P(kps[i]); g.beginPath(); g.arc(A.x, A.y, 6, 0, 7); g.fill(); });
    if (T.mode === 'pullup' && T.det.barY != null) { // 估计的单杠高度
      const y = oy + T.det.barY * s;
      g.setLineDash([10, 8]); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
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

  // 调试数据：训练中数字一直在变、来不及截图，所以全程记录，结束后在结果页 / 历史详情里慢慢看
  function traceHTML(tr) {
    if (!tr || !tr.length) return '';
    const f = v => v == null ? ' -- ' : (v < 0 ? '' : ' ') + v.toFixed(2);
    const lines = tr.map(r => `${String(r[0].toFixed(1)).padStart(5)}s 左${f(r[1])} 右${f(r[2])} 肘${r[3] == null ? '--' : r[3]} 手${f(r[4])} 速${f(r[5])} 脚${r[6] ? '✓' : '✗'} 姿${r[7] ? '✓' : '✗'} ${r[8] ? '▶计时' : '·'}`);
    return `<details class="list"><summary style="padding:12px 14px;color:var(--mute);font-size:14px">调试数据（${tr.length} 行，用于调参）</summary>
      <pre class="trace">时间 左/右脚离地(unit) 肘角 手腕高 肩速 脚ok 姿势ok 计时\n${lines.join('\n')}</pre></details>`;
  }
  /* ---------- 识别模型（Heavy / Full） ---------- */
  const syncPose = () => $$('#segPose button').forEach(b => b.classList.toggle('on', b.dataset.v === HR_MODELS.variant()));
  $$('#segPose button').forEach(b => b.onclick = () => { HR_MODELS.setVariant(b.dataset.v); syncPose(); });
  syncPose();

  /* ---------- 体重 / 热量估算 ---------- */
  const getWeight = () => { try { return +localStorage.getItem('hr_weight') || 0; } catch (e) { return 0; } };
  $('#weight').value = getWeight() || '';
  $('#weight').onchange = () => {
    const w = +$('#weight').value;
    try { if (w >= 20 && w <= 250) localStorage.setItem('hr_weight', String(w)); else { localStorage.removeItem('hr_weight'); $('#weight').value = ''; } } catch (e) {}
  };
  // 活动能量（千卡），未填体重返回 0
  function kcalOf(s) {
    const w = getWeight(), r = s.result;
    if (!w) return 0;
    const [met, activeMs] = s.mode === 'hang' ? [C.KCAL_HANG_MET, r.totalMs] : [C.KCAL_PULLUP_MET, r.total * C.KCAL_PULLUP_REP_SEC * 1000];
    const restMs = Math.max(0, s.durationMs - activeMs);
    return Math.round(((met - 1) * activeMs + (C.KCAL_REST_MET - 1) * restMs) / 3600000 * w * 10) / 10;
  }
  const kcalStat = s => { const k = kcalOf(s); return stat('估算消耗', k ? k + ' 千卡' : '<small>首页填体重</small>'); };

  // 动作分析报告（见 report.js）
  function reportHTML(s) {
    const R = HR_REPORT.build(s);
    if (!R) return '';
    const esc = x => String(x);
    const fault = (f, main) => `<div class="ana ${main ? 'main' : ''}"><b>${f.name}${f.n && f.N > 1 ? `<em>${f.n}/${f.N}</em>` : ''}</b>
      <small>${f.why}</small>${f.cue ? `<p class="cue">口令：${f.cue}</p>` : ''}${main && f.drill ? `<p class="drill">纠正练习：${f.drill}</p>` : ''}</div>`;
    let h = `<div class="list rep"><h3>动作分析</h3>
      <div class="rep-head"><div class="rep-score"><b>${R.score}</b><small>${R.grade}</small></div><div>${R.headline}${R.meta.length ? `<small>${R.meta.join('<br>')}</small>` : ''}</div></div>`;
    if (R.priority) h += `<div class="rep-sec">首要改进</div>` + fault(R.priority, true);
    if (R.faults.length) h += `<div class="rep-sec">其他问题</div>` + R.faults.map(f => fault(f)).join('');
    if (R.goods.length) h += `<div class="rep-sec">做得好的</div><div class="ana good">${R.goods.map(x => `<p>✓ ${x}</p>`).join('')}</div>`;
    h += `<div class="rep-sec">${s.mode === 'hang' ? '每段' : '每次'}明细</div><div class="rep-tbl"><table><tr>${R.table.cols.map(x => `<th>${x}</th>`).join('')}</tr>${R.table.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    h += `<div class="rep-sec">训练安排</div><div class="ana">${R.plan.map(x => `<p>· ${x}</p>`).join('')}</div></div>`;
    return h;
  }

  function detailHTML(s) {
    const r = s.result;
    let h = `<p class="hint" style="margin-top:0">${fmtDate(s.startedAt)} · 本轮用时 ${fmtLong(s.durationMs)}</p><div class="stats">`;
    if (s.mode === 'hang') {
      h += stat('总悬挂时长', fmt(r.totalMs), 'hl') + stat('悬挂段数', r.count) + stat('中断次数', r.interruptions) +
        stat('平均单次', fmt(r.avgMs)) + stat('最长单次', fmt(r.maxMs)) + kcalStat(s) + '</div>';
      h += reportHTML(s);
      h += rows('每段悬挂（按时间顺序）', r.segments.map((x, i) => [`第 ${i + 1} 段 · +${fmt(x.offsetMs).replace(/\.\d$/, '')}`, fmt(x.ms)]));
      h += traceHTML(r.trace);
    } else {
      const best = r.groups.length ? Math.max(...r.groups) : 0;
      h += stat('总次数', r.total, 'hl') + stat('组数', r.groups.length) + stat('最多一组', best) + kcalStat(s) + '</div>';
      h += reportHTML(s);
      h += rows('每组次数', r.groups.map((n, i) => [`第 ${i + 1} 组`, n + ' 次']));
    }
    return h;
  }
  const btn = (label, cls, fn, dis) => { const b = document.createElement('button'); b.className = 'abtn ' + cls; b.textContent = label; b.disabled = !!dis; b.onclick = fn; return b; };

  // 写入苹果健康：网页无法直接访问 HealthKit，借助 iOS「快捷指令」记录一次体能训练（见 README）。
  // 传 JSON：{"seconds": 本轮用时秒数, "start": "yyyy-MM-dd HH:mm:ss" 开始时间（本地时间）, "kcal": 估算活动能量}
  const ymdhms = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const SENT = '✓ 已发送到健康（可再发一次）';
  function sendHealth(s) {
    const seconds = Math.max(1, Math.round(s.durationMs / 1000));
    s.healthAt = Date.now();
    if (s.id != null) DB.put(s).catch(console.error);
    location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(C.HEALTH_SHORTCUT) + '&input=text&text=' + encodeURIComponent(JSON.stringify({ seconds, start: ymdhms(s.startedAt), kcal: kcalOf(s) }));
  }
  function healthBtn(s) {
    const b = btn(s.healthAt ? SENT : '❤︎ 写入苹果健康', '', () => { sendHealth(s); b.textContent = SENT; });
    return b;
  }
  // 训练刚结束：询问是否写入健康（跳转快捷指令必须由点击触发，所以用按钮而不是自动跳转）
  function askHealth(s, hb) {
    const k = kcalOf(s), card = document.createElement('div');
    card.className = 'card'; card.style.marginBottom = '14px';
    card.innerHTML = `<b>写入苹果健康？</b><small style="display:block;color:var(--mute);margin:4px 0 12px">记录一次功能性力量训练：${fmtLong(s.durationMs)}${k ? ' · ' + k + ' 千卡' : ''}</small>`;
    const row = document.createElement('div'); row.className = 'row2';
    const done = () => card.remove();
    row.append(btn('写入', 'pri', () => { sendHealth(s); hb.textContent = SENT; done(); }), btn('暂不', '', done));
    card.appendChild(row);
    $('#rBody').prepend(card);
  }

  function showResult(s, o = {}) {
    $('#rTitle').textContent = MODE_NAME[s.mode] + (o.fresh ? ' · 本轮结果' : '');
    $('#rBody').innerHTML = o.empty ? '<p class="empty">本轮没有记录到有效数据，未保存。</p>' + (s.mode === 'hang' ? traceHTML(s.result.trace) : '') : detailHTML(s);
    const a = $('#rActions'); a.innerHTML = '';
    if (o.fresh) {
      const hb = healthBtn(s);
      if (o.saved) askHealth(s, hb);
      a.append(
        btn(o.saved ? '✓ 已保存到历史' : '本轮无数据，未保存', '', null, true),
        ...(o.saved ? [hb] : []),
        btn('再来一组', 'pri', () => enterTrain(s.mode)),
        btn('返回首页', '', () => show('home')));
    } else {
      let armed = false;
      const del = btn('删除这条记录', 'bad', async () => {
        if (!armed) { armed = true; del.textContent = '再点一次确认删除'; return; }
        await DB.remove(s.id); openHistory();
      });
      a.append(healthBtn(s), del, btn('返回列表', '', openHistory));
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
      b.innerHTML = `<span class="ico">${ICON[s.mode]}</span><span><b>${sum}</b><small>${MODE_NAME[s.mode]} · ${fmtDate(s.startedAt)}</small></span>`;
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
      if (x > 0) svg += `<rect x="${bx}" y="${Tp + ph - h}" width="${w}" height="${h}" rx="${Math.min(4, w / 2)}" fill="#ff5e1a"/>`;
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
