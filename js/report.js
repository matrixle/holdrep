/* 动作分析报告：根据识别器记录的每段 / 每次统计，按规则生成姿态与训练建议。
 * build(session) -> [{ lv: 'ok'|'tip'|'warn'|'info', t: 标题, d: 说明 }] | null（旧记录没有统计数据）
 * 阈值见 config.js 的 AN_*。基于前置摄像头 2D 画面，看不到前后方向的摆动。 */
(function (g) {
  'use strict';
  const C = () => g.HR_CONFIG;
  const avg = q => q.reduce((a, b) => a + b, 0) / q.length;
  const sec = ms => (ms / 1000).toFixed(1) + ' 秒';
  const round5 = s => Math.ceil(s / 5) * 5;

  function hang(r) {
    const c = C(), segs = r.segments.filter(x => x.st);
    if (!segs.length) return null;
    const out = [], W = segs.reduce((s, x) => s + x.st.n, 0), wavg = k => segs.reduce((s, x) => s + x.st[k] * x.st.n, 0) / W;
    const ang = Math.round(wavg('ang'));
    if (ang >= c.AN_HANG_ELBOW_OK) out.push({ lv: 'ok', t: `手臂伸直（平均肘角 ${ang}°）`, d: '悬垂姿势标准，由肩背和握力承重。' });
    else out.push({ lv: ang < c.AN_HANG_ELBOW_WARN ? 'warn' : 'tip', t: `手肘偏弯（平均肘角 ${ang}°）`,
      d: 'Dead Hang 应尽量把手臂完全伸直，让肩背与握力承重；屈臂会变成二头肌发力的屈臂悬垂。伸直后坚持不住，就缩短单次时间。' });

    const spd = wavg('spd'), sw = segs.filter(x => x.st.sway != null), sway = sw.length ? avg(sw.map(x => x.st.sway)) : 0;
    if (spd > c.AN_HANG_SPEED || sway > c.AN_HANG_SWAY) out.push({ lv: 'tip', t: '身体有晃动',
      d: '上杠后先停稳；收紧腹部、双腿并拢略向前，可以减少摆动，也更省握力。' });
    else out.push({ lv: 'ok', t: '身体稳定', d: '悬垂过程中晃动很小。' });

    const tilt = wavg('tilt'), ds = segs.filter(x => x.st.diff != null), diff = ds.length ? avg(ds.map(x => x.st.diff)) : 0;
    const asym = [];
    if (Math.abs(tilt) > c.AN_TILT) asym.push(`${tilt > 0 ? '左' : '右'}肩偏低`);
    if (Math.abs(diff) > c.AN_ELBOW_DIFF) asym.push(`${diff > 0 ? '右' : '左'}臂更弯（差 ${Math.round(Math.abs(diff))}°）`);
    if (asym.length) out.push({ lv: 'tip', t: '左右不对称：' + asym.join('，'),
      d: '先检查双手握距是否以身体为中心对称。若每次都偏向同一侧，可能是该侧肩背或握力较弱，可加单侧悬垂、单臂辅助练习。' });
    else out.push({ lv: 'ok', t: '左右对称', d: '两侧肩膀高度和手臂弯曲程度基本一致。' });

    const sh = segs.filter(x => x.st.shrug != null && x.ms >= 5000);
    if (sh.length) {
      const shrug = avg(sh.map(x => x.st.shrug));
      if (shrug > c.AN_HANG_SHRUG) out.push({ lv: 'tip', t: '后段肩膀逐渐上耸',
        d: '悬垂后期肩膀向耳朵靠拢（变成被动悬垂）。被动悬垂可以拉伸肩部；若想练肩胛稳定和握力，试试「主动悬垂」：肩胛下沉、胸口微挺，肩膀远离耳朵。' });
      else out.push({ lv: 'ok', t: '肩部位置保持良好', d: '整段悬垂中肩膀没有明显上耸。' });
    }

    const ms = r.segments.map(x => x.ms), best = Math.max(...ms);
    if (ms.length >= 3 && ms[ms.length - 1] < ms[0] * 0.6) out.push({ lv: 'info', t: '后段明显衰减',
      d: `第 1 段 ${sec(ms[0])}，最后一段 ${sec(ms[ms.length - 1])}。握力恢复需要时间，段间休息 60–90 秒效果更好。` });
    out.push({ lv: 'info', t: `下次目标：单次 ${round5(best / 1000 * 1.1)} 秒`, d: `本轮最长 ${sec(best)}，每次进步 10% 左右比较稳妥。` });
    return out;
  }

  function pullup(r) {
    const c = C(), R = r.repStats;
    if (!R) return null;
    if (!R.length && !r.partials) return [];
    const out = [], N = R.length;
    if (N) {
      const shallow = R.filter(x => x.bot != null && x.bot < c.AN_PU_FULL_EXT).length;
      if (shallow) out.push({ lv: 'tip', t: `${shallow}/${N} 次底部没伸直`,
        d: '每次下放到手臂接近伸直再拉下一次，全程动作才能完整练到背阔肌；半程容易高估自己的次数。' });
      else out.push({ lv: 'ok', t: '底部伸直到位', d: '每次都回到了手臂伸直的起始位。' });

      const low = R.filter(x => x.chin != null && x.chin > 0).length;
      if (low) out.push({ lv: 'tip', t: `${low}/${N} 次下巴未过杠`, d: '已按宽松标准计数；想做标准引体，拉到下巴高于杠再下放。' });
      else out.push({ lv: 'ok', t: '顶部到位', d: '每次下巴都接近或超过杠。' });
    }
    if (r.partials) out.push({ lv: 'warn', t: `${r.partials} 次拉起未到顶（未计数）`,
      d: '说明已接近力竭。可以在这时结束本组，或用弹力带辅助、跳起后慢放（离心）完成剩余次数。' });
    if (N) {
      const down = avg(R.map(x => x.down)), up = avg(R.map(x => x.up));
      if (down < c.AN_PU_ECC_MIN_MS) out.push({ lv: 'tip', t: `下放偏快（平均 ${sec(down)}）`,
        d: '下放（离心）阶段控制在 2–3 秒，力量和肌肉增长效果更好，也更保护肘和肩。' });
      else out.push({ lv: 'ok', t: `下放有控制（平均 ${sec(down)}）`, d: `拉起平均 ${sec(up)}。` });

      const cheat = R.filter(x => (x.leg != null && x.leg > c.AN_PU_LEG_DRIVE) || (x.sway != null && x.sway > c.AN_PU_SWAY)).length;
      if (cheat) out.push({ lv: 'tip', t: `${cheat}/${N} 次有蹬腿 / 摆动借力`,
        d: '双腿并拢（可微屈膝、交叉脚踝），收紧核心，靠背部把身体拉上去，而不是用腿或摆荡带上去。' });
      else out.push({ lv: 'ok', t: '没有明显借力', d: '身体控制稳定。' });

      const tilt = avg(R.map(x => x.tilt || 0)), ds = R.filter(x => x.diff != null), diff = ds.length ? avg(ds.map(x => x.diff)) : 0;
      if (tilt > c.AN_TILT * 1.5 || Math.abs(diff) > c.AN_ELBOW_DIFF * 1.5) out.push({ lv: 'tip', t: '拉起时左右不对称',
        d: `${Math.abs(diff) > c.AN_ELBOW_DIFF * 1.5 ? `到顶时${diff > 0 ? '右' : '左'}臂弯得更多（差 ${Math.round(Math.abs(diff))}°），说明这一侧出力更多。` : '拉起时身体有侧倾。'}检查握距是否对称；可加单臂划船等单侧训练平衡两边力量。` });

      if (N >= 4) {
        const a = (R[0].up + R[1].up) / 2, b = (R[N - 1].up + R[N - 2].up) / 2;
        if (b > a * c.AN_PU_SLOWDOWN) out.push({ lv: 'info', t: `后程拉起变慢 ${Math.round((b / a - 1) * 100)}%`,
          d: '最后几次明显吃力，接近力竭。这组可当作极限组，下一组适当减少次数，保证动作质量。' });
      }
    }
    const gs = r.groups, best = gs.length ? Math.max(...gs) : 0;
    if (best) out.push({ lv: 'info', t: `下次目标：一组 ${best + 1} 次`, d: gs.length > 1 ? `本轮 ${gs.length} 组：${gs.join(' / ')} 次。` : '每次比上次多 1 次，循序渐进。' });
    return out;
  }

  g.HR_REPORT = { build: s => s.mode === 'hang' ? hang(s.result) : pullup(s.result) };
})(typeof window !== 'undefined' ? window : globalThis);
