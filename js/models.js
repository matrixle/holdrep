/* 姿态模型：MediaPipe BlazePose Full（实测在 Dead Hang 上最准，已去掉 MoveNet）。
 * 统一接口：estimate(video) -> { keypoints: [{x,y,score}] } | null
 * 输出 COCO-17 顺序的关键点（像素坐标），检测逻辑因此与模型无关：
 *   0 鼻 5/6 肩 7/8 肘 9/10 腕 11/12 髋 13/14 膝 15/16 踝 */
(function (g) {
  'use strict';
  const T0 = performance.now();
  const st = t => { // 当前阶段 + 带时间戳的日志（超时时显示在屏幕上，也输出到控制台）
    g.HR_MODELS.stage = t;
    const line = ((performance.now() - T0) / 1000).toFixed(1) + 's ' + t;
    g.HR_MODELS.log.push(line); console.log('[HR]', line);
  };

  // BlazePose 33 点 → COCO-17
  const BP = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const BP_TO = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  async function blaze() {
    st('加载 MediaPipe 脚本');
    const mod = await import(new URL('vendor/mediapipe/vision_bundle.mjs', document.baseURI).href);
    st('加载 wasm');
    const fileset = await mod.FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
    const make = delegate => mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: 'vendor/mediapipe/pose_landmarker_full.task', delegate },
      runningMode: 'VIDEO', numPoses: 1 });
    let lm; st('加载模型(GPU)');
    try { lm = await make('GPU'); g.HR_MODELS.backend = 'GPU'; }
    catch (e) { console.warn('GPU 委托失败，退回 CPU', e); st('GPU 失败，加载模型(CPU)'); lm = await make('CPU'); g.HR_MODELS.backend = 'CPU'; }
    st('模型就绪');
    let lastTs = 0;
    return { estimate: async v => {
      const ts = Math.max(performance.now(), lastTs + 1); lastTs = ts;
      const res = lm.detectForVideo(v, ts), p = res.landmarks && res.landmarks[0];
      if (!p) return null;
      const W = v.videoWidth, H = v.videoHeight, kps = [];
      BP.forEach((src, i) => { const l = p[src]; kps[BP_TO[i]] = { x: l.x * W, y: l.y * H, score: l.visibility == null ? 1 : l.visibility }; });
      return { keypoints: kps };
    } };
  }

  let cache = null;
  g.HR_MODELS = {
    label: 'BlazePose', stage: '', backend: '', log: [],
    load() { return cache || (cache = blaze().catch(e => { cache = null; throw e; })); },
  };
})(window);
