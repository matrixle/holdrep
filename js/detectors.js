/* 动作识别：把姿态关键点（COCO-17 顺序）转成「悬垂计时」与「引体计数」状态机。
 * 关键点序号：0 鼻 5/6 左右肩 7/8 左右肘 9/10 左右腕 11/12 左右髋。
 * 图像坐标系 y 向下，所以「更高」= y 更小。 */
(function (g) {
  'use strict';
  const cfg = () => g.HR_CONFIG;

  function kp(k, i) {
    const p = k[i];
    return p && p.score >= cfg().MIN_KP_SCORE ? p : null;
  }

  // 三点夹角（在 b 处）
  function angle(a, b, c) {
    const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (!d) return null;
    return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI;
  }

  // 提取姿势特征；肩膀不可见则视为没人
  function analyze(pose) {
    if (!pose || !pose.keypoints) return null;
    const k = pose.keypoints;
    const lS = kp(k, 5), rS = kp(k, 6);
    if (!lS || !rS) return null;
    const shoMid = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
    let unit = Math.hypot(lS.x - rS.x, lS.y - rS.y); // 身体单位 ≈ 肩宽
    const lH = kp(k, 11), rH = kp(k, 12);
    let hipMid = null;
    if (lH && rH) {
      hipMid = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2 };
      const torso = Math.hypot((lH.x + rH.x) / 2 - shoMid.x, (lH.y + rH.y) / 2 - shoMid.y);
      unit = Math.max(unit, torso * 0.6);
    }
    if (unit < 4) return null;
    const arms = [], angLR = [null, null];
    [[lS, 7, 9], [rS, 8, 10]].forEach(([s, ei, wi], side) => {
      const e = kp(k, ei), w = kp(k, wi);
      if (!e || !w) return;
      const ang = angle(s, e, w);
      if (ang == null) return;
      angLR[side] = ang;
      arms.push({ angle: ang, wristUp: (s.y - w.y) / unit, wrist: w });
    });
    // ---- 动作分析用特征（长度 / unit，≈ 肩宽）----
    const lK = kp(k, 13), rK = kp(k, 14), knees = [lK, rK].filter(Boolean), nose = kp(k, 0);
    const legY = hipMid && knees.length ? (knees.reduce((s, q) => s + q.y, 0) / knees.length - hipMid.y) / unit : null; // 膝-髋竖直距离，抬腿时变小
    const ears = [[lS, kp(k, 3)], [rS, kp(k, 4)]].filter(x => x[1]);
    const earSho = ears.length ? ears.reduce((s, [sh, e]) => s + sh.y - e.y, 0) / ears.length / unit : null; // 耳-肩距离，耸肩时变小
    const earY = ears.length ? ears.reduce((s, x) => s + x[1].y, 0) / ears.length : null;
    const sw = Math.hypot(lS.x - rS.x, lS.y - rS.y), lW = kp(k, 9), rW = kp(k, 10);
    // 脚踝/膝盖的高度，左右分开，各自与自己的地面基线比较，
    // 这样站立时双脚前后位置不同、或只抬一只脚，都不会被误判为离地。
    // 只用脚踝、不用脚尖：悬垂时脚尖自然下垂，抬高量偏小；且 BlazePose 在拖鞋上的脚尖/脚跟点不稳。
    const y = i => { const p = kp(k, i); return p ? p.y : null; };
    return { shoMid, unit, arms, nose, hipMid, angLR, legY, earSho,
      head: earY != null && nose ? (earY - nose.y) / unit : null,    // 鼻子高出耳朵多少：仰头 / 伸脖子够杠时变大
      grip: lW && rW ? Math.abs(lW.x - rW.x) / sw : null,             // 握距 / 肩宽
      tilt: (lS.y - rS.y) / unit,                                      // >0 = 左肩低
      w3: pose.world ? world3(pose.world, k, sw) : null,
      ankle: [y(15), y(16)], knee: [y(13), y(14)],
      armsDown: arms.length >= 1 && arms.every(m => m.wristUp < 0) }; // 双手垂在身侧 = 站在地面
  }

  // 3D 世界坐标特征（米，原点髋部，y 向下，z 越小越近镜头）。手机仰拍会让绝对角度有偏差，所以分析时只看相对自身起始姿态的变化。
  const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const mid3 = (a, b) => a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } : null;
  const len3 = v => Math.hypot(v.x, v.y, v.z);
  function ang3(a, b, c) {
    const u = sub3(a, b), v = sub3(c, b), d = len3(u) * len3(v);
    return d ? Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / d))) * 180 / Math.PI : null;
  }
  function world3(W, k, sw) {
    const v = i => W[i] && kp(k, i) ? W[i] : null; // 2D 可见的点才用
    const S = mid3(v(5), v(6)), H = mid3(v(11), v(12)), K = mid3(v(13), v(14)), A = mid3(v(15), v(16)), o = {};
    if (S) { const d = len3(sub3(W[5], W[6])); if (d > 0.05) { o.mpp = d / sw; o.rot = (W[5].z - W[6].z) / d; } } // 米/像素；躯干扭转
    if (S && H) o.lean = Math.atan2(S.z - H.z, H.y - S.y) * 180 / Math.PI;  // 躯干前后倾角
    if (S && H && K) o.hip = ang3(S, H, K);                                  // 髋角：抬腿 / 收腹时变小
    if (H && K && A) o.knee = ang3(H, K, A);                                 // 膝角
    if (H && A) o.ankZ = A.z - H.z;                                          // 脚相对髋的前后位置（米）
    // 掌心朝向：手腕→食指根 × 手腕→小指根 的法向 z；左右手符号相反，相减得到同一判据（正握 / 反握）
    const pz = (wi, pi, ii) => { const w = v(wi), p = v(pi), i = v(ii); if (!w || !p || !i) return null; const a = sub3(i, w), b = sub3(p, w); return (a.x * b.y - a.y * b.x) * 1e4; };
    const L = pz(9, 17, 19), R = pz(10, 18, 20);
    if (L != null && R != null) o.palm = L - R;
    return o;
  }

  function makeDt(self, t, onGap) {
    let dt = self.lastT == null ? 0 : t - self.lastT;
    self.lastT = t;
    if (dt > cfg().MAX_FRAME_GAP_MS) { onGap(); dt = 0; }
    return dt;
  }

  /* ---------------- Dead Hang ---------------- */
  class HangDetector {
    constructor() { this.reset(); }
    reset() {
      this.segments = [];      // 已结束的悬挂段 {startT, ms}
      this.cur = 0;            // 当前段已累计时长
      this.segStartT = 0;
      this.active = false;
      this.validMs = 0;        // 进入前的连续有效时长
      this.prevValid = false;
      this.lostMs = 0;         // 悬垂中已丢失的时长
      this.lastT = null;
      this.prevSho = null;
      this.speed = 0;
      this.present = false;
      // 地面校准：双手放下站立时记录脚踝/膝盖的 y，之后脚比它高 = 离地
      this.ground = { ankle: [null, null], knee: [null, null], unit: null };
      this.groundState = 'nocalib'; // nocalib | unknown | onground | lifted
      this.liftSides = null;
      this.trace = []; this._lastTrace = -1e9; // 调试轨迹：约每 0.5s 一行 + 状态切换时
      this.lift = null;             // 当前「较低那只脚」的离地高度（unit），仅供调试显示
      this.st = null;               // 当前段的动作统计（动作分析报告用）
    }
    // 悬垂中逐帧累计（动作分析用）：肘角、晃动、左右对称、耸肩、躯干/腿部前后摆动、握距握法
    _stat(a) {
      const s = this.st || (this.st = { ang: [], spd: [], tilt: [], diff: [], hx: [], ear: [], head: [], grip: [], palm: [], rot: [], lean: [], hip: [], ankZ: [] });
      const push = (key, v) => { if (v != null && isFinite(v)) s[key].push(v); };
      push('ang', Math.min(...a.arms.map(m => m.angle))); push('spd', this.speed); push('tilt', a.tilt);
      if (a.angLR[0] != null && a.angLR[1] != null) push('diff', a.angLR[0] - a.angLR[1]);
      if (a.hipMid) push('hx', a.hipMid.x / a.unit);
      push('ear', a.earSho); push('head', a.head); push('grip', a.grip);
      if (a.w3) { push('palm', a.w3.palm); push('rot', a.w3.rot); push('lean', a.w3.lean); push('hip', a.w3.hip); push('ankZ', a.w3.ankZ); }
    }
    _stSummary() {
      const s = this.st; if (!s || !s.ang.length) return null;
      const r2 = x => x == null ? null : Math.round(x * 100) / 100, r0 = x => x == null ? null : Math.round(x);
      const avg = q => q.length ? q.reduce((a, b) => a + b, 0) / q.length : null;
      const sd = q => { if (q.length < 3) return null; const m = avg(q); return Math.sqrt(avg(q.map(x => (x - m) ** 2))); };
      const head = (q, n) => avg(q.slice(0, n)), tail = (q, n) => avg(q.slice(-n));
      const n = s.ang.length, qn = Math.max(5, Math.floor(n / 4));
      return { n, ang: r0(avg(s.ang)), minAng: r0(Math.min(...s.ang)), spd: r2(avg(s.spd)),
        tremor: n >= 40 ? r2(tail(s.spd, qn) / Math.max(0.02, head(s.spd, qn))) : null,      // 后 1/4 晃动 ÷ 前 1/4
        tilt: r2(avg(s.tilt)), diff: r0(avg(s.diff)), sway: r2(sd(s.hx)),
        shrug: s.ear.length >= 20 ? r2(head(s.ear, 10) - tail(s.ear, 10)) : null,           // >0 = 后段肩膀向耳朵靠拢
        head: r2(avg(s.head)), grip: r2(avg(s.grip)), palm: r0(avg(s.palm)), rot: r2(avg(s.rot)),
        leanSd: r0(sd(s.lean)), hip: r0(avg(s.hip)), ankZSd: r2(sd(s.ankZ)) };
    }
    _learn(a) {
      if (!a || !a.armsDown) return;
      const g = this.ground, ema = (o, n) => o == null ? n : o * 0.9 + n * 0.1;
      let any = false;
      ['ankle', 'knee'].forEach(key => [0, 1].forEach(i => {
        if (a[key][i] != null) { g[key][i] = ema(g[key][i], a[key][i]); any = true; }
      }));
      if (any) g.unit = ema(g.unit, a.unit);
    }
    calibrate(pose) { this._learn(analyze(pose)); } // 未开始/暂停时也持续校准
    // 双脚都必须离地：取两侧离地高度的较小者
    _feetOff(a) {
      const c = cfg(), g = this.ground;
      if (!c.HANG_REQUIRE_FEET_OFF_GROUND) return true;
      const thr = c.HANG_FEET_LIFT * (this.active ? c.HANG_FEET_HOLD_RATIO : 1); // 已悬垂时放宽，防抖
      let d = null;
      for (const key of ['ankle', 'knee']) {
        if ([0, 1].every(i => g[key][i] != null && a[key][i] != null)) {
          this.liftSides = [0, 1].map(i => (g[key][i] - a[key][i]) / g.unit);
          d = Math.min(...this.liftSides); break;
        }
      }
      this.lift = d;
      if (d == null) {
        this.liftSides = null;
        this.groundState = g.ankle.every(v => v == null) && g.knee.every(v => v == null) ? 'nocalib' : 'unknown';
        return false;
      }
      this.groundState = d >= thr ? 'lifted' : 'onground';
      return d >= thr;
    }
    get totalMs() { return this.segments.reduce((s, x) => s + x.ms, 0) + this.cur; }
    get status() { return this.active ? 'hanging' : (this.segments.length ? 'paused' : 'waiting'); }

    _end() {
      if (this.active && this.cur >= cfg().HANG_MIN_SEGMENT_MS) {
        this.segments.push({ startT: this.segStartT, ms: this.cur, st: this._stSummary() });
      }
      this.st = null;
      this.active = false; this.cur = 0; this.validMs = 0; this.lostMs = 0; this.prevValid = false;
    }
    interrupt() { this._end(); this.lastT = null; this.prevSho = null; }

    _isHang(a) {
      const c = cfg();
      const minAngle = this.active ? c.HANG_ANGLE_HOLD : c.HANG_ANGLE_ENTER;
      const need = c.HANG_REQUIRE_BOTH_ARMS ? 2 : 1;
      return a.arms.length >= need &&
        a.arms.every(m => m.angle >= minAngle && m.wristUp >= c.HANG_WRIST_ABOVE);
    }

    update(pose, t) {
      const c = cfg();
      const dt = makeDt(this, t, () => { this._end(); this.prevSho = null; });
      const a = analyze(pose);
      this.present = !!a;
      this._learn(a);
      // 身体是否静止：肩部中点的归一化速度（EMA 平滑）
      if (a && this.prevSho && dt > 0) {
        const sp = Math.hypot(a.shoMid.x - this.prevSho.x, a.shoMid.y - this.prevSho.y) / a.unit / (dt / 1000);
        this.speed = this.speed * 0.7 + sp * 0.3;
      } else if (!a) this.speed = 0;
      this.prevSho = a ? a.shoMid : null;

      const hang = !!a && this._isHang(a), feet = !!a && this._feetOff(a);
      const valid = hang && feet && this.speed <= c.HANG_MAX_SWING_SPEED;
      const wasActive = this.active;

      if (!this.active) {
        if (valid) {
          this.validMs = this.prevValid ? this.validMs + dt : 0;
          if (this.validMs >= c.HANG_ENTER_MS) {
            this.active = true;
            this.cur = this.validMs;           // 回溯补上去抖期
            this.segStartT = t - this.validMs;
            this.lostMs = 0;
          }
        } else this.validMs = 0;
        this.prevValid = valid;
      } else if (valid) {
        this.cur += dt + this.lostMs;          // 短暂丢失（<EXIT_MS）后恢复，补回丢失时间
        this.lostMs = 0;
      } else {
        this.lostMs += dt;
        if (this.lostMs >= c.HANG_EXIT_MS) this._end(); // 丢失期间不计入时长
      }
      if (this.active && a && valid) this._stat(a);
      // 调试轨迹：t, 左脚离地, 右脚离地, 最小肘角, 最小手腕高度, 肩速, 脚离地ok, 姿势ok(valid), 计时中
      if (a && (this.active !== wasActive || t - this._lastTrace >= 500) && this.trace.length < 2400) {
        this._lastTrace = t;
        const r2 = x => x == null ? null : Math.round(x * 100) / 100, ls = this.liftSides || [];
        this.trace.push([t, r2(ls[0]), r2(ls[1]),
          a.arms.length ? Math.round(Math.min(...a.arms.map(m => m.angle))) : null,
          a.arms.length ? r2(Math.min(...a.arms.map(m => m.wristUp))) : null,
          r2(this.speed), feet ? 1 : 0, valid ? 1 : 0, this.active ? 1 : 0]);
      }
    }

    finish(t0) {
      this._end();
      const n = this.segments.length;
      const total = this.segments.reduce((s, x) => s + x.ms, 0);
      return {
        trace: this.trace.map(r => [Math.round((r[0] - t0) / 100) / 10, ...r.slice(1)]),
        segments: this.segments.map(s => ({ offsetMs: Math.round(s.startT - t0), ms: Math.round(s.ms), st: s.st })),
        totalMs: Math.round(total),
        count: n,
        interruptions: Math.max(0, n - 1),
        avgMs: n ? Math.round(total / n) : 0,
        maxMs: n ? Math.round(Math.max(...this.segments.map(s => s.ms))) : 0,
      };
    }
  }

  /* ---------------- Pull-up / Chin-up ---------------- */
  class PullupDetector {
    constructor(onRep) { this.onRep = onRep || (() => {}); this.reset(); }
    reset() {
      this.count = 0;
      this.reps = [];          // 每次完成时的时间戳
      this.status = 'waiting'; // waiting | ready | pulling | paused
      this.armed = false;      // 已在起始位确认过，可以开始记一次 rep
      this.topReached = false; // 本次 rep 下巴已过杠
      this.startFrames = 0; this.topFrames = 0;
      this.lostMs = 0; this.outMs = 0;
      this.barY = null;        // 单杠高度估计（手腕平均 y）
      this.lastT = null;
      this.present = false;
      this.repStats = [];      // 每次完成的动作统计（动作分析报告用）
      this.partials = 0;       // 离开起始位、未到顶就回来的次数（半程/失败）
      this.rep = null; this.botAng = null; this.startT = 0;
      this.done = null;        // 刚完成、等待确定「下放结束时刻」的 rep
      this.base = null;        // 起始位（底部悬垂）时的姿态基准，用于判断每次动作中的变化
      this.gripAcc = { grip: [], palm: [] };
    }
    // 起始位逐帧更新姿态基准：ang = 本次底部最大肘角；其余特征只在手臂接近最伸直时更新（EMA），避免混入开始发力的帧
    _base(a, ang) {
      const f = { shoY: a.shoMid.y, ear: a.earSho, head: a.head, lean: a.w3 && a.w3.lean, hip: a.w3 && a.w3.hip, knee: a.w3 && a.w3.knee, ankZ: a.w3 && a.w3.ankZ, legY: a.legY };
      if (!this.base || this.startFrames === 1) this.base = Object.assign({ ang }, f);
      else {
        this.base.ang = Math.max(this.base.ang, ang);
        if (ang >= this.base.ang - 5) for (const key in f) if (f[key] != null) this.base[key] = this.base[key] == null ? f[key] : this.base[key] * 0.7 + f[key] * 0.3;
      }
      if (a.grip != null && this.gripAcc.grip.length < 600) this.gripAcc.grip.push(a.grip);
      if (a.w3 && a.w3.palm != null && this.gripAcc.palm.length < 600) this.gripAcc.palm.push(a.w3.palm);
    }
    // 一次 rep 进行中逐帧记录（结束时汇总，见 _flushRep）
    _track(a, t) {
      if (!a.arms.length) return;
      const c = cfg(), ang = a.arms.reduce((s, m) => s + m.angle, 0) / a.arms.length;
      const r = this.rep || (this.rep = { t0: t, base: Object.assign({}, this.base), minAng: 180, f: [] });
      if (ang < r.minAng) r.minAng = ang;
      const w = a.w3 || {};
      r.f.push({ t, ang, shoY: a.shoMid.y, mpp: w.mpp, ear: a.earSho, head: a.head,
        chin: this.barY != null && a.nose ? (a.nose.y + c.PULLUP_CHIN_OFFSET * a.unit - this.barY) / a.unit : null, // <0 = 下巴高于杠
        hx: a.hipMid ? a.hipMid.x / a.unit : null, legY: a.legY, lean: w.lean, hip: w.hip, knee: w.knee, ankZ: w.ankZ,
        tilt: a.tilt, diff: a.angLR[0] != null && a.angLR[1] != null ? a.angLR[0] - a.angLR[1] : null, rot: w.rot });
    }
    // rep 汇总。阶段划分：起始 → 进入顶部区（肘角 ≤ 最小肘角+10°）= 拉起；顶部区停留 = 顶停；离开顶部区 → 手臂伸直 = 下放
    _flushRep() {
      if (!this.done) return;
      const r = this.done, b = r.base || {}, F = r.f; this.done = null;
      if (!F.length) return;
      const tEnd = r.tEnd != null ? r.tEnd : r.tStart, zone = r.minAng + 10;
      const iA = F.findIndex(x => x.ang <= zone), iB = F.length - 1 - [...F].reverse().findIndex(x => x.ang <= zone);
      const A = F[iA], B = F[iB], top = F.reduce((m, x) => x.ang < m.ang ? x : m, F[0]);
      const vals = k => F.map(x => x[k]).filter(v => v != null && isFinite(v));
      const mn = k => { const q = vals(k); return q.length ? Math.min(...q) : null; }, mx = k => { const q = vals(k); return q.length ? Math.max(...q) : null; };
      const avg = q => q.length ? q.reduce((s, v) => s + v, 0) / q.length : null;
      const nearTop = F.slice(iA, iB + 1), topAvg = k => avg(nearTop.map(x => x[k]).filter(v => v != null));
      const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100, r0 = x => x == null || !isFinite(x) ? null : Math.round(x);
      const up = A.t - r.t0, mpp = avg(vals('mpp')), rise = b.shoY != null ? b.shoY - topAvg('shoY') : null;
      const rng = k => { const q = vals(k); return q.length ? Math.max(...q) - Math.min(...q) : null; };
      this.repStats.push({
        up: r0(up), hold: r0(B.t - A.t), down: r0(tEnd - B.t),
        bot: r0(b.ang), top: r0(r.minAng), chin: r2(mn('chin')),
        vel: mpp && rise != null && up > 0 ? r2(rise * mpp / (up / 1000)) : null,             // 平均拉起速度 m/s
        shrug: b.ear != null && topAvg('ear') != null ? r2(b.ear - topAvg('ear')) : null,    // >0 = 顶部耸肩（耳肩距离比底部还小）
        crane: b.head != null && top.head != null ? r2(top.head - b.head) : null,           // >0 = 顶部仰头 / 伸脖子
        hipFlex: b.hip != null && mn('hip') != null ? r0(b.hip - mn('hip')) : null,          // 髋角减小（抬腿 / 收腹）
        kneeFlex: b.knee != null && mn('knee') != null ? r0(b.knee - mn('knee')) : null,     // 膝角减小（蹬腿）
        ankZ: r2(rng('ankZ')), lean: r0(rng('lean')),                                        // 脚前后摆幅（米）、躯干前后摆动（度）
        leg: b.legY != null && mn('legY') != null ? r2(b.legY - mn('legY')) : null, sway: r2(rng('hx')),
        tilt: r2(Math.max(...vals('tilt').map(Math.abs), 0)), diff: r0(top.diff), rot: r2(Math.max(...vals('rot').map(Math.abs), 0)) });
    }
    _pause() {
      this._flushRep(); this.rep = null;
      this.armed = false; this.topReached = false;
      this.startFrames = 0; this.topFrames = 0;
      this.outMs = 0; this.lostMs = 0;
      if (this.status !== 'waiting') this.status = 'paused'; // 次数保留
    }
    interrupt() { this._pause(); this.lastT = null; }

    update(pose, t) {
      const c = cfg();
      const dt = makeDt(this, t, () => this._pause());
      const a = analyze(pose);
      this.present = !!a;

      if (!a) {
        this.startFrames = 0; this.topFrames = 0;
        this.lostMs += dt;
        if (this.lostMs >= c.PULLUP_LOST_PAUSE_MS) this._pause();
        return;
      }
      this.lostMs = 0;

      // 起始位：手臂伸直且手腕明显高于肩
      const atStart = a.arms.length >= 1 &&
        a.arms.every(m => m.angle >= c.PULLUP_START_ANGLE && m.wristUp >= c.PULLUP_WRIST_ABOVE);

      if (atStart) {
        this.outMs = 0; this.topFrames = 0; this.startFrames++;
        const ang = a.arms.reduce((s, m) => s + m.angle, 0) / a.arms.length;
        if (this.startFrames === 1) { this.startT = t; this.botAng = ang; this.extT = null; } else this.botAng = Math.max(this.botAng, ang);
        this._base(a, ang);
        if (this.extT == null && ang >= c.AN_PU_FULL_EXT) this.extT = t; // 本次回到起始位后，手臂首次伸直的时刻
        if (this.done && this.done.tEnd == null) this.done.tEnd = this.extT;
        const wy = a.arms.reduce((s, m) => s + m.wrist.y, 0) / a.arms.length;
        this.barY = this.barY == null ? wy : this.barY * 0.9 + wy * 0.1;
        if (this.startFrames >= c.PULLUP_START_FRAMES) {
          // 回到起始位且途中到过顶 → 完整 1 rep
          if (this.armed && this.topReached) {
            this.count++; this.reps.push(t); this.onRep(this.count);
            if (this.rep) { this._flushRep(); this.done = Object.assign(this.rep, { tStart: this.startT, tEnd: this.extT }); }
          } else if (this.armed && this.rep && this.rep.minAng <= c.PULLUP_START_ANGLE - 15) this.partials++; // 拉了但没到顶
          this.rep = null;
          this.armed = true; this.topReached = false; this.status = 'ready';
        }
      } else {
        this.startFrames = 0;
        this._flushRep();
        if (this.armed) this.status = 'pulling';
        this.outMs += dt;
        if (this.armed) {
          this._track(a, t);
          // 到顶（宽松）：下巴接近/过杠，或手臂明显弯曲，满足其一即可
          let top = false;
          if (this.barY != null && a.nose) {
            const chinY = a.nose.y + c.PULLUP_CHIN_OFFSET * a.unit;
            top = chinY <= this.barY + c.PULLUP_CHIN_MARGIN * a.unit;
          }
          if (!top && c.PULLUP_TOP_ELBOW_ANGLE && a.arms.length) {
            top = a.arms.reduce((t, m) => t + m.angle, 0) / a.arms.length <= c.PULLUP_TOP_ELBOW_ANGLE;
          }
          if (top) {
            if (++this.topFrames >= c.PULLUP_TOP_FRAMES) this.topReached = true;
          } else this.topFrames = 0;
        }
        if (this.outMs >= c.PULLUP_OUT_OF_START_PAUSE_MS) this._pause();
      }
    }

    // 按间隔自然拆组
    static groups(reps, gap) {
      const out = [];
      reps.forEach((t, i) => {
        if (i === 0 || t - reps[i - 1] > gap) out.push(1); else out[out.length - 1]++;
      });
      return out;
    }
    get currentGroup() {
      const gs = PullupDetector.groups(this.reps, cfg().GROUP_GAP_MS);
      return gs.length;
    }
    finish(t0) {
      this._pause();
      return {
        total: this.count,
        repTimes: this.reps.map(t => Math.round(t - t0)),
        groups: PullupDetector.groups(this.reps, cfg().GROUP_GAP_MS),
        repStats: this.repStats, partials: this.partials,
        grip: (q => q.length ? Math.round(q.reduce((a, b) => a + b, 0) / q.length * 100) / 100 : null)(this.gripAcc.grip),
        palm: (q => q.length ? Math.round(q.reduce((a, b) => a + b, 0) / q.length) : null)(this.gripAcc.palm),
      };
    }
  }

  g.HR_DET = { HangDetector, PullupDetector, analyze };
})(typeof window !== 'undefined' ? window : globalThis);
