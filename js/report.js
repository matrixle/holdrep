/* 动作分析报告：把识别器记录的每段 / 每次统计，按教练常用的动作标准评估，给出
 *   总评分 → 首要改进（原因 + 口令 + 纠正练习）→ 其他问题 → 做得好的 → 每次明细 → 训练安排。
 * build(session) -> 报告对象 | null（旧记录没有统计数据）。阈值见 config.js 的 AN_*。 */
(function (g) {
  'use strict';
  const C = () => g.HR_CONFIG;
  const avg = q => q.length ? q.reduce((a, b) => a + b, 0) / q.length : null;
  const has = v => v != null && isFinite(v);
  const sec = ms => (ms / 1000).toFixed(1);
  const grade = s => s >= 90 ? '优秀' : s >= 75 ? '良好' : s >= 60 ? '合格' : '需改进';

  /* ---------------- 引体向上 ---------------- */
  // 动作问题库：w = 每次扣分；why = 为什么重要；cue = 训练时默念的口令；drill = 纠正练习
  const PU = {
    bottom: { name: '底部未伸直', w: 15,
      why: '没有回到手臂伸直，背阔肌在拉长位得不到训练，次数也会被高估（半程引体）。',
      cue: '每次下到手肘伸直、肩膀被拉开，再起下一次。',
      drill: '暂停引体：底部停 1 秒再拉，3 组 × 平时次数的 60%。' },
    top: { name: '下巴未过杠', w: 20,
      why: '顶部行程不足，上背（中下斜方肌、菱形肌）最后一段收缩没有练到。',
      cue: '想象把杠拉向锁骨，用胸口去找杠，而不是把下巴伸过去。',
      drill: '顶部静态保持 3 × 10 秒 + 离心引体（跳到顶部，3–5 秒慢放）3 × 3–5 次。' },
    shrug: { name: '顶部耸肩', w: 10,
      why: '到顶时肩膀靠近耳朵，说明肩胛没有下沉，上斜方肌代偿，长期容易肩颈不适、肩峰下撞击。',
      cue: '先沉肩再拉；手肘往后裤兜方向插，肩膀远离耳朵。',
      drill: '肩胛引体（手臂伸直，只做沉肩 – 放松）3 × 8–10 次，每次沉肩停 1 秒。' },
    crane: { name: '伸脖子够杠', w: 10,
      why: '靠仰头把下巴"送"过杠，身体实际没有上去，还会增加颈椎压力。',
      cue: '下巴微收、视线平视，用胸口去找杠。',
      drill: '降低次数、先保证行程；顶部保持时练习收下巴。' },
    kip: { name: '借力（摆动 / 蹬腿）', w: 20,
      why: '屈髋、蹬腿或身体前后摆荡把人带上去，背部做功减少，严格引体不计这种次数。',
      cue: '臀部夹紧、腹部收紧，双腿并拢略向前（空心体），全程身体像一块板。',
      drill: '空心体支撑 3 × 20–30 秒；严格慢速引体（2 秒上、3 秒下）。' },
    ecc: { name: '下放过快', w: 10,
      why: '下放（离心）阶段对力量和肌肉增长贡献很大；自由落体式下放还会冲击肘和肩。',
      cue: '心里数"1、2、3"慢放到底。',
      drill: '离心引体 3 × 3–5 次，每次 3–5 秒放到底。' },
    asym: { name: '左右不对称', w: 10,
      why: '一侧出力更多（到顶时这侧手臂更弯、身体侧倾或扭转），长期会放大两侧力量差异。',
      cue: '两侧手肘同时到底、同时到顶，身体始终正对单杠。',
      drill: '单臂哑铃划船 / 单侧高位下拉，弱侧先练并多做 1–2 次。' },
  };

  function puFaults(x) {
    const c = C(), f = [];
    if (has(x.bot) && x.bot < c.AN_LOCKOUT) f.push('bottom');
    if (has(x.chin) && x.chin > 0) f.push('top');
    if (has(x.shrug) && x.shrug > c.AN_PU_SHRUG) f.push('shrug');
    if (has(x.crane) && x.crane > c.AN_PU_CRANE) f.push('crane');
    const kip3d = (has(x.hipFlex) && x.hipFlex > c.AN_PU_HIPFLEX) || (has(x.kneeFlex) && x.kneeFlex > c.AN_PU_KNEEFLEX) ||
      (has(x.ankZ) && x.ankZ > c.AN_PU_ANKZ) || (has(x.lean) && x.lean > c.AN_PU_LEAN);
    const kip2d = (has(x.leg) && x.leg > c.AN_PU_LEG_DRIVE) || (has(x.sway) && x.sway > c.AN_PU_SWAY);
    if (kip3d || kip2d) f.push('kip');
    if (has(x.down) && x.down < c.AN_PU_ECC_MIN_MS) f.push('ecc');
    if ((has(x.diff) && Math.abs(x.diff) > c.AN_ELBOW_DIFF * 1.5) || (has(x.tilt) && x.tilt > c.AN_TILT * 1.5) || (has(x.rot) && x.rot > c.AN_ROT)) f.push('asym');
    return f;
  }
  const TAG = { bottom: '底部', top: '过杠', shrug: '耸肩', crane: '伸脖', kip: '借力', ecc: '快放', asym: '不对称' };

  function gripText(r) {
    const c = C(), out = [];
    if (has(r.palm) && Math.abs(r.palm) >= 3) out.push(r.palm * c.AN_PALM_SIGN > 0 ? '正握（Pull-up）' : '反握（Chin-up）');
    if (has(r.grip)) out.push(`握距 ${r.grip.toFixed(1)} 倍肩宽` + (r.grip < c.AN_GRIP_NARROW ? '（窄握）' : r.grip > c.AN_GRIP_WIDE ? '（过宽）' : '（标准）'));
    return out.join(' · ');
  }

  function pullup(r) {
    const c = C(), R = r.repStats;
    if (!R) return null;
    if (!R.length && !r.partials) return null;
    const N = R.length, per = R.map(puFaults), count = {};
    per.forEach(f => f.forEach(k => count[k] = (count[k] || 0) + 1));
    const scores = per.map(f => Math.max(0, 100 - f.reduce((s, k) => s + PU[k].w, 0)));
    let score = N ? Math.round(avg(scores)) : 0;
    if (r.partials) score = Math.max(0, score - 5 * r.partials);
    const clean = scores.filter(s => s === 100).length;

    // 首要改进：出现次数 × 扣分 最大的问题
    const ranked = Object.keys(count).sort((a, b) => count[b] * PU[b].w - count[a] * PU[a].w || PU[b].w - PU[a].w);
    const detail = k => {
      const X = R.filter((x, i) => per[i].includes(k)); // 只看出现该问题的那几次
      if (k === 'ecc') return `${X.length > 1 ? '这几次平均' : '这次'}下放 ${sec(avg(X.map(x => x.down)))} 秒，目标 2–3 秒。`;
      if (k === 'asym') {
        const d = avg(X.map(x => x.diff).filter(has));
        return has(d) && Math.abs(d) > c.AN_ELBOW_DIFF ? `到顶时${d > 0 ? '右' : '左'}臂多弯 ${Math.round(Math.abs(d))}°，这一侧出力更多。` : '拉起时身体有侧倾或扭转。';
      }
      if (k === 'kip') {
        const hf = avg(X.map(x => x.hipFlex).filter(has)), az = avg(X.map(x => x.ankZ).filter(has));
        return has(hf) ? `屈髋 ${Math.round(hf)}°、脚前后摆动 ${Math.round((az || 0) * 100)} 厘米。` : '';
      }
      if (k === 'bottom') return `底部肘角 ${Math.round(avg(X.map(x => x.bot)))}°（伸直约 170°+）。`;
      return '';
    };
    const fault = k => ({ k, name: PU[k].name, n: count[k], N, why: (detail(k) + ' ' + PU[k].why).trim(), cue: PU[k].cue, drill: PU[k].drill });
    const faults = ranked.map(fault);
    if (r.partials) faults.push({ k: 'partial', name: `${r.partials} 次拉起未到顶（未计数）`, why: '说明已接近力竭，继续硬拉容易动作变形。', cue: '拉不到顶时就结束本组。', drill: '用弹力带辅助或离心引体补足剩余次数。' });

    // 速度损失（VBT）：后两次平均速度 vs 本组最快
    const V = R.map(x => x.vel).filter(has);
    let vloss = null;
    if (V.length >= 4) { const best = Math.max(...V.slice(0, Math.ceil(V.length / 2))), last = avg(V.slice(-2)); vloss = best > 0 ? 1 - last / best : null; }
    if (has(vloss) && vloss > c.AN_PU_VLOSS) faults.push({ k: 'fatigue', name: `速度损失 ${Math.round(vloss * 100)}%`, why: '最后几次拉起速度比最快时下降了四成以上，已明显疲劳，此时动作最容易变形。', cue: '速度明显变慢就结束本组。', drill: '' });

    const goods = [];
    const allOk = k => N && !count[k];
    if (allOk('bottom')) goods.push('每次底部都伸直到位');
    if (allOk('top')) goods.push('每次下巴都过杠');
    if (allOk('shrug') && R.some(x => has(x.shrug))) goods.push('到顶时肩胛下沉，没有耸肩');
    if (allOk('kip')) goods.push('身体稳定，没有借力');
    const down = avg(R.map(x => x.down));
    if (N && down >= c.AN_PU_ECC_GOOD_MS) goods.push(`下放有控制（平均 ${sec(down)} 秒）`);
    if (allOk('asym')) goods.push('左右对称');

    const rows = R.map((x, i) => [i + 1, sec(x.up), sec(x.hold || 0), sec(x.down), has(x.vel) ? x.vel.toFixed(2) : '–', scores[i], per[i].map(k => TAG[k]).join(' ') || '✓']);

    // 训练安排
    const best = r.groups.length ? Math.max(...r.groups) : 0, plan = [];
    const span = (a, b) => (a = Math.max(2, Math.round(best * a))) === (b = Math.max(2, Math.round(best * b))) ? `${a}` : `${a}–${b}`;
    if (best <= 3) plan.push('当前重点是打基础：每周 2–3 次，每次 4 组 × 3–5 次离心引体（3–5 秒慢放）+ 2 组 × 20–30 秒顶部静态保持，组间 2 分钟。');
    else if (best <= 7) plan.push(`每周 2–3 次：4 组 × ${span(0.6, 0.75)} 次严格引体，组间 2–3 分钟；每周总次数逐步增加 5–10%。`);
    else if (best <= 12) plan.push(`每周 2–3 次：5 组 × ${span(0.6, 0.7)} 次，加入暂停引体（顶部停 2 秒）或 3 秒慢放变式。`);
    else plan.push('可以进阶：负重引体（从体重的 5–10% 起）4 组 × 5–6 次，或练习弓箭手引体为单臂做准备。');
    if (V.length >= 3) plan.push(`用速度控制每组：当拉起明显变慢（比本组最快一次慢约 30%）就结束该组${has(vloss) ? `（本轮速度损失 ${Math.round(vloss * 100)}%）` : ''}。`);
    if (faults.length && faults[0].drill) plan.push(`纠正练习：${faults[0].drill}`);
    plan.push(`下次目标：一组 ${best + 1} 次，且动作评分不低于本次。`);

    const meta = [gripText(r), N ? `平均拉起 ${sec(avg(R.map(x => x.up)))} 秒 · 顶停 ${sec(avg(R.map(x => x.hold || 0)))} 秒 · 下放 ${sec(down)} 秒` : ''].filter(Boolean);
    return { score, grade: grade(score),
      headline: N ? `${N} 次中 ${clean} 次完全标准` + (faults.length ? `，主要问题：${faults[0].name}` + (faults[0].n ? `（${faults[0].n} 次）` : '') : '') : `没有完成的次数`,
      priority: faults[0] || null, faults: faults.slice(1), goods, meta, plan,
      table: { cols: ['#', '上(秒)', '停', '下', '速度 m/s', '分', '问题'], rows } };
  }

  /* ---------------- Dead Hang ---------------- */
  const HG = {
    elbow: { name: '手肘未伸直', w: 20,
      why: 'Dead Hang 要求手臂完全伸直，由握力和肩带承重；屈臂会转成二头肌发力，降低对握力与肩部的训练效果。',
      cue: '手臂像挂钩一样完全伸直，只用手指和肩膀挂住身体。',
      drill: '伸直后坚持不了太久就缩短单次时间、增加组数，不要靠屈臂硬撑。' },
    swing: { name: '身体晃动', w: 15,
      why: '晃动会额外消耗握力，也说明核心没有收紧。',
      cue: '上杠后先停稳 1–2 秒；腹部收紧，双腿并拢略向前（空心体）。',
      drill: '空心体支撑 3 × 20–30 秒。' },
    asym: { name: '左右不对称', w: 10,
      why: '身体侧倾、扭转或一侧手臂更弯，说明两侧握力或肩部力量不均。',
      cue: '双手握距以身体为中心对称，两侧肩膀一样高。',
      drill: '单臂交替悬垂（另一手轻扶）：弱侧先练，每侧 3 × 10–15 秒。' },
    passive: { name: '后段转为被动悬垂（耸肩）', w: 10,
      why: '肩膀逐渐向耳朵靠拢，肩关节改由韧带和关节囊承重。被动悬垂适合拉伸，但练握力和肩胛稳定时应保持主动。',
      cue: '肩胛下沉、胸口微挺，肩膀远离耳朵（主动悬垂）。',
      drill: '主动 / 被动交替悬垂：每 10 秒切换一次，3 组。' },
    grip: { name: '握距不合适', w: 5,
      why: '握距过宽会增加肩部压力，过窄则肩带参与不足。',
      cue: '双手比肩略宽（约 1.2–1.5 倍肩宽）。',
      drill: '' },
  };

  function hang(r) {
    const c = C(), segs = r.segments.filter(x => x.st && Array.isArray(x.st.ang) === false && has(x.st.ang));
    if (!segs.length) return null;
    const segFaults = x => {
      const s = x.st, f = [];
      if (s.ang < c.AN_HANG_ELBOW_OK) f.push('elbow');
      if (s.spd > c.AN_HANG_SPEED || (has(s.sway) && s.sway > c.AN_HANG_SWAY) || (has(s.leanSd) && s.leanSd > c.AN_HANG_LEAN_SD) || (has(s.ankZSd) && s.ankZSd > c.AN_HANG_ANKZ_SD)) f.push('swing');
      if (Math.abs(s.tilt) > c.AN_TILT || (has(s.diff) && Math.abs(s.diff) > c.AN_ELBOW_DIFF) || (has(s.rot) && Math.abs(s.rot) > c.AN_ROT)) f.push('asym');
      if (has(s.shrug) && x.ms >= 5000 && s.shrug > c.AN_HANG_SHRUG) f.push('passive');
      if (has(s.grip) && (s.grip < c.AN_GRIP_NARROW || s.grip > c.AN_GRIP_WIDE)) f.push('grip');
      return f;
    };
    const per = segs.map(segFaults), count = {};
    per.forEach(f => f.forEach(k => count[k] = (count[k] || 0) + 1));
    const scores = per.map((f, i) => Math.max(0, 100 - f.reduce((s, k) => s + HG[k].w + (k === 'elbow' && segs[i].st.ang < c.AN_HANG_ELBOW_WARN ? 10 : 0), 0)));
    const W = segs.reduce((s, x) => s + x.ms, 0), score = Math.round(segs.reduce((s, x, i) => s + scores[i] * x.ms, 0) / W);
    const wavg = k => { const q = segs.filter(x => has(x.st[k])); const w = q.reduce((s, x) => s + x.ms, 0); return w ? q.reduce((s, x) => s + x.st[k] * x.ms, 0) / w : null; };

    const detail = k => {
      if (k === 'elbow') return `平均肘角 ${Math.round(wavg('ang'))}°（伸直约 170°+）。`;
      if (k === 'asym') {
        const t = wavg('tilt'), d = wavg('diff'), parts = [];
        if (Math.abs(t) > c.AN_TILT) parts.push(`${t > 0 ? '左' : '右'}肩偏低`);
        if (has(d) && Math.abs(d) > c.AN_ELBOW_DIFF) parts.push(`${d > 0 ? '右' : '左'}臂更弯`);
        return parts.length ? parts.join('、') + '。' : '';
      }
      if (k === 'grip') return `握距 ${wavg('grip').toFixed(1)} 倍肩宽。`;
      return '';
    };
    const ranked = Object.keys(count).sort((a, b) => count[b] * HG[b].w - count[a] * HG[a].w || HG[b].w - HG[a].w);
    const faults = ranked.map(k => ({ k, name: HG[k].name, n: count[k], N: segs.length, why: (detail(k) + ' ' + HG[k].why).trim(), cue: HG[k].cue, drill: HG[k].drill }));
    const tr = segs.map(x => x.st.tremor).filter(has);
    if (tr.length && Math.max(...tr) > c.AN_HANG_TREMOR) faults.push({ k: 'tremor', name: '后段明显抖动', why: '每段后期晃动是前期的两倍以上，是握力接近极限的信号。', cue: '开始抖动后再坚持 5–10 秒就可以结束这一段，保证质量。', drill: '' });
    const ms = r.segments.map(x => x.ms);
    if (ms.length >= 3 && ms[ms.length - 1] < ms[0] * 0.6) faults.push({ k: 'decay', name: '各段时长衰减明显', why: `第 1 段 ${sec(ms[0])} 秒，最后一段 ${sec(ms[ms.length - 1])} 秒，握力恢复不足。`, cue: '段间休息 60–90 秒再上杠。', drill: '' });

    const goods = [], none = k => !count[k];
    if (none('elbow')) goods.push(`手臂伸直（平均肘角 ${Math.round(wavg('ang'))}°）`);
    if (none('swing')) goods.push('身体稳定，几乎没有晃动');
    if (none('asym')) goods.push('左右对称');
    if (none('passive') && segs.some(x => has(x.st.shrug) && x.ms >= 5000)) goods.push('全程保持肩部位置，没有逐渐耸肩');
    const hip = wavg('hip'), meta = [];
    if (has(hip)) meta.push(hip < 150 ? '屈膝悬垂（适合低杠；想加强核心可尝试直腿并拢的空心体悬垂）' : '直腿悬垂');
    const gr = wavg('grip'), pa = wavg('palm');
    meta.push(gripText({ grip: gr, palm: pa }));

    const best = Math.max(...ms) / 1000, plan = [];
    if (best < 20) plan.push(`每周 3–4 次：5 组 × ${Math.max(5, Math.round(best * 0.6))} 秒，组间 60 秒；每周把单次时长提高 2–3 秒。`);
    else if (best <= 60) plan.push(`每周 3 次：4 组 × ${Math.round(best * 0.7)} 秒，组间 60–90 秒，最后一组坚持到力竭。`);
    else plan.push('可以进阶：负重悬垂（背包 5–10 kg）、毛巾 / 粗把握杠，或单臂交替悬垂。');
    if (faults.length && faults[0].drill) plan.push(`纠正练习：${faults[0].drill}`);
    plan.push(`下次目标：单次 ${Math.ceil(best * 1.1 / 5) * 5} 秒，且动作评分不低于本次。`);

    const rows = segs.map((x, i) => [i + 1, sec(x.ms), x.st.ang + '°', has(x.st.spd) ? x.st.spd.toFixed(2) : '–', scores[i], per[i].map(k => ({ elbow: '屈肘', swing: '晃动', asym: '不对称', passive: '耸肩', grip: '握距' })[k]).join(' ') || '✓']);
    return { score, grade: grade(score),
      headline: `${segs.length} 段悬垂，最长 ${sec(best * 1000)} 秒` + (faults.length ? `，主要问题：${faults[0].name}` : '，动作标准'),
      priority: faults[0] || null, faults: faults.slice(1), goods, meta: meta.filter(Boolean), plan,
      table: { cols: ['段', '时长(秒)', '肘角', '晃动', '分', '问题'], rows } };
  }

  /* ---------------- Wall Sit 靠墙静蹲 ---------------- */
  const WS = {
    high: { name: '蹲得偏高（大腿未到水平）', w: 20,
      why: '标准靠墙静蹲是大腿与地面平行、膝角约 90°；位置越高，股四头肌负荷越小，训练效果打折扣。',
      cue: '后背贴墙往下滑，直到大腿与地面平行，膝盖在脚踝正上方。',
      drill: '暂时蹲不到水平，就先在能坚持 20 秒的高度练，每周往下降一点。' },
    rise: { name: '后段逐渐站高', w: 10,
      why: '坚持不住时不自觉把臀部往上抬，负荷变小，后半段的时间"打了折"。',
      cue: '感觉要往上滑时，宁可提前结束这一段，也不要抬高。',
      drill: '缩短单段、增加组数：每组只做能保持标准高度的时长。' },
    swing: { name: '身体不稳', w: 10,
      why: '上身晃动或频繁调整，说明核心和下肢没有稳定发力，也可能后背没有贴实墙面。',
      cue: '后背、臀部贴墙，双手抱胸或放在大腿上不动，均匀呼吸，不要憋气。',
      drill: '' },
    asym: { name: '重心偏一侧', w: 10,
      why: '两侧大腿高度不同或身体侧倾，说明一条腿承担了更多负荷，长期会放大两侧力量差异。',
      cue: '双脚与肩同宽、脚尖朝前，体重均匀压在两只脚上。',
      drill: '单腿靠墙静蹲（另一只脚轻点地）：弱侧先练，每侧 3 × 10–15 秒。' },
  };

  function wallsit(r) {
    const c = C(), segs = r.segments.filter(x => x.st && has(x.st.spd));
    if (!segs.length) return null;
    // 侧面拍时大腿 / 小腿比不可用（大腿不压缩），改看 2D 膝角
    const side = x => has(x.st.ang) && x.st.ang <= 140;
    const segFaults = x => {
      const s = x.st, f = [];
      if (side(x) ? s.ang > c.AN_WS_KNEE : has(s.r) && s.r > c.AN_WS_DEPTH) f.push('high');
      if (x.ms >= 10000 && (side(x) ? has(s.riseAng) && s.riseAng > 10 : has(s.rise) && s.rise > c.AN_WS_RISE)) f.push('rise');
      if (s.spd > c.AN_WS_SPEED || (has(s.sway) && s.sway > c.AN_HANG_SWAY)) f.push('swing');
      if (Math.abs(s.tilt) > c.AN_TILT || (has(s.diff) && Math.abs(s.diff) > c.AN_WS_LR)) f.push('asym');
      return f;
    };
    const per = segs.map(segFaults), count = {};
    per.forEach(f => f.forEach(k => count[k] = (count[k] || 0) + 1));
    const scores = per.map(f => Math.max(0, 100 - f.reduce((s, k) => s + WS[k].w, 0)));
    const W = segs.reduce((s, x) => s + x.ms, 0), score = Math.round(segs.reduce((s, x, i) => s + scores[i] * x.ms, 0) / W);
    const wavg = k => { const q = segs.filter(x => has(x.st[k])); const w = q.reduce((s, x) => s + x.ms, 0); return w ? q.reduce((s, x) => s + x.st[k] * x.ms, 0) / w : null; };

    const detail = k => {
      if (k === 'asym') {
        const t = wavg('tilt'), d = wavg('diff'), parts = [];
        if (Math.abs(t) > c.AN_TILT) parts.push(`${t > 0 ? '左' : '右'}肩偏低`);
        if (has(d) && Math.abs(d) > c.AN_WS_LR) parts.push(`${d > 0 ? '左' : '右'}腿蹲得更高`);
        return parts.length ? parts.join('、') + '。' : '';
      }
      return '';
    };
    const ranked = Object.keys(count).sort((a, b) => count[b] * WS[b].w - count[a] * WS[a].w || WS[b].w - WS[a].w);
    const faults = ranked.map(k => ({ k, name: WS[k].name, n: count[k], N: segs.length, why: (detail(k) + ' ' + WS[k].why).trim(), cue: WS[k].cue, drill: WS[k].drill }));
    const tr = segs.map(x => x.st.tremor).filter(has);
    if (tr.length && Math.max(...tr) > c.AN_HANG_TREMOR) faults.push({ k: 'tremor', name: '后段明显抖动', why: '每段后期晃动是前期的两倍以上，是大腿肌肉接近力竭的信号。', cue: '腿开始明显发抖后再坚持 5–10 秒就可以起身，保证质量。', drill: '' });
    const ms = r.segments.map(x => x.ms);
    if (ms.length >= 3 && ms[ms.length - 1] < ms[0] * 0.6) faults.push({ k: 'decay', name: '各段时长衰减明显', why: `第 1 段 ${sec(ms[0])} 秒，最后一段 ${sec(ms[ms.length - 1])} 秒，组间恢复不足。`, cue: '段间休息 60–90 秒，起身走动、拉伸大腿前侧。', drill: '' });

    const goods = [], none = k => !count[k];
    if (none('high')) goods.push('下蹲到位，大腿基本与地面平行');
    if (none('rise') && segs.some(x => x.ms >= 10000)) goods.push('全程保持高度，没有逐渐站起');
    if (none('swing')) goods.push('身体稳定');
    if (none('asym')) goods.push('左右对称，重心居中');
    const meta = ['膝盖不要超过脚尖、不要内扣；膝盖有不适就升高位置或停止'];

    const best = Math.max(...ms) / 1000, plan = [];
    if (best < 30) plan.push(`每周 3–4 次：4 组 × ${Math.max(10, Math.round(best * 0.7))} 秒，组间 60 秒；每周把单次时长提高 5 秒。`);
    else if (best <= 90) plan.push(`每周 3 次：3 组 × ${Math.round(best * 0.8)} 秒，组间 60–90 秒，最后一组坚持到力竭。`);
    else plan.push('可以进阶：手持哑铃 / 背包负重、膝间夹球，或单腿靠墙静蹲。');
    if (faults.length && faults[0].drill) plan.push(`纠正练习：${faults[0].drill}`);
    plan.push(`下次目标：单次 ${Math.ceil(best * 1.1 / 5) * 5} 秒，且动作评分不低于本次。`);

    const rows = segs.map((x, i) => [i + 1, sec(x.ms), per[i].includes('high') ? '偏高' : '到位', has(x.st.spd) ? x.st.spd.toFixed(2) : '–', scores[i],
      per[i].map(k => ({ high: '偏高', rise: '站高', swing: '不稳', asym: '偏侧' })[k]).join(' ') || '✓']);
    return { score, grade: grade(score),
      headline: `${segs.length} 段静蹲，最长 ${sec(best * 1000)} 秒` + (faults.length ? `，主要问题：${faults[0].name}` : '，动作标准'),
      priority: faults[0] || null, faults: faults.slice(1), goods, meta, plan,
      table: { cols: ['段', '时长(秒)', '深度', '晃动', '分', '问题'], rows } };
  }

  g.HR_REPORT = { build: s => s.mode === 'hang' ? hang(s.result) : s.mode === 'wallsit' ? wallsit(s.result) : pullup(s.result) };
})(typeof window !== 'undefined' ? window : globalThis);
