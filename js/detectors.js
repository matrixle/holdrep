/* 动作识别：把 MoveNet 关键点转成「悬垂计时」与「引体计数」状态机。
 * MoveNet 关键点序号：0 鼻 5/6 左右肩 7/8 左右肘 9/10 左右腕 11/12 左右髋。
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
    if (lH && rH) {
      const torso = Math.hypot((lH.x + rH.x) / 2 - shoMid.x, (lH.y + rH.y) / 2 - shoMid.y);
      unit = Math.max(unit, torso * 0.6);
    }
    if (unit < 4) return null;
    const arms = [];
    [[lS, 7, 9], [rS, 8, 10]].forEach(([s, ei, wi]) => {
      const e = kp(k, ei), w = kp(k, wi);
      if (!e || !w) return;
      const ang = angle(s, e, w);
      if (ang == null) return;
      arms.push({ angle: ang, wristUp: (s.y - w.y) / unit, wrist: w });
    });
    const avgY = ids => { const q = ids.map(i => kp(k, i)).filter(Boolean); return q.length ? q.reduce((t, x) => t + x.y, 0) / q.length : null; };
    return { shoMid, unit, arms, nose: kp(k, 0),
      ankleY: avgY([15, 16]), kneeY: avgY([13, 14]),
      armsDown: arms.length >= 1 && arms.every(m => m.wristUp < 0) }; // 双手垂在身侧 = 站在地面
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
      this.ground = { ankle: null, knee: null, unit: null };
      this.groundState = 'nocalib'; // nocalib | unknown | onground | lifted
    }
    _learn(a) {
      if (!a || !a.armsDown) return;
      const g = this.ground, ema = (o, n) => o == null ? n : o * 0.9 + n * 0.1;
      if (a.ankleY != null) g.ankle = ema(g.ankle, a.ankleY);
      if (a.kneeY != null) g.knee = ema(g.knee, a.kneeY);
      if (a.ankleY != null || a.kneeY != null) g.unit = ema(g.unit, a.unit);
    }
    calibrate(pose) { this._learn(analyze(pose)); } // 未开始/暂停时也持续校准
    _feetOff(a) {
      const c = cfg(), g = this.ground;
      if (!c.HANG_REQUIRE_FEET_OFF_GROUND) return true;
      const lift = c.HANG_FEET_LIFT * (this.active ? 0.5 : 1); // 已悬垂时放宽，防抖
      let d = null;
      if (g.ankle != null && a.ankleY != null) d = (g.ankle - a.ankleY) / g.unit;
      else if (g.knee != null && a.kneeY != null) d = (g.knee - a.kneeY) / g.unit;
      if (d == null) { this.groundState = g.ankle == null && g.knee == null ? 'nocalib' : 'unknown'; return false; }
      this.groundState = d >= lift ? 'lifted' : 'onground';
      return d >= lift;
    }
    get totalMs() { return this.segments.reduce((s, x) => s + x.ms, 0) + this.cur; }
    get status() { return this.active ? 'hanging' : (this.segments.length ? 'paused' : 'waiting'); }

    _end() {
      if (this.active && this.cur >= cfg().HANG_MIN_SEGMENT_MS) {
        this.segments.push({ startT: this.segStartT, ms: this.cur });
      }
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

      const valid = !!a && this._isHang(a) && this._feetOff(a) && this.speed <= c.HANG_MAX_SWING_SPEED;

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
    }

    finish(t0) {
      this._end();
      const n = this.segments.length;
      const total = this.segments.reduce((s, x) => s + x.ms, 0);
      return {
        segments: this.segments.map(s => ({ offsetMs: Math.round(s.startT - t0), ms: Math.round(s.ms) })),
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
    }
    _pause() {
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
        const wy = a.arms.reduce((s, m) => s + m.wrist.y, 0) / a.arms.length;
        this.barY = this.barY == null ? wy : this.barY * 0.9 + wy * 0.1;
        if (this.startFrames >= c.PULLUP_START_FRAMES) {
          // 回到起始位且途中到过顶 → 完整 1 rep
          if (this.armed && this.topReached) {
            this.count++; this.reps.push(t); this.onRep(this.count);
          }
          this.armed = true; this.topReached = false; this.status = 'ready';
        }
      } else {
        this.startFrames = 0;
        if (this.armed) this.status = 'pulling';
        this.outMs += dt;
        if (this.armed && this.barY != null && a.nose) {
          const chinY = a.nose.y + c.PULLUP_CHIN_OFFSET * a.unit;
          if (chinY <= this.barY + c.PULLUP_CHIN_MARGIN * a.unit) {
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
      };
    }
  }

  g.HR_DET = { HangDetector, PullupDetector, analyze };
})(typeof window !== 'undefined' ? window : globalThis);
