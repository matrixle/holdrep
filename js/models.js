/* 姿态模型加载与统一接口：estimate(video) -> { keypoints: [{x,y,score}] } | null
 * 所有模型都输出 COCO-17 顺序的关键点（像素坐标），检测逻辑因此与模型无关：
 *   0 鼻 5/6 肩 7/8 肘 9/10 腕 11/12 髋 13/14 膝 15/16 踝
 * BlazePose 额外附带 17/18 脚跟、19/20 脚尖（用于更稳的「脚离地」判断）。 */
(function (g) {
  'use strict';
  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('加载失败 ' + src));
    document.head.appendChild(s);
  });

  const T0 = performance.now();
  const st = t => { // 当前阶段 + 带时间戳的日志（超时时显示在屏幕上，也输出到控制台）
    g.HR_MODELS.stage = t;
    const line = ((performance.now() - T0) / 1000).toFixed(1) + 's ' + t;
    g.HR_MODELS.log.push(line); console.log('[HR]', line);
  };
  async function tfReady() {
    if (!g.tf) {
      st('加载 tf.js'); await loadScript('vendor/tf.min.js');
      st('加载 pose-detection'); await loadScript('vendor/pose.min.js');
    }
    st('初始化 WebGL');
    const ok = await Promise.race([tf.setBackend('webgl'), new Promise(r => setTimeout(r, 15000, 'timeout'))]);
    if (ok !== true) { st('WebGL 失败，改用 CPU'); await tf.setBackend('cpu'); } // 慢，但保证能跑
    await tf.ready();
    g.HR_MODELS.backend = tf.getBackend();
  }

  function movenet(type, url) {
    return async () => {
      await tfReady();
      // 拆开步骤，便于定位 iOS 上究竟卡在 下载 / 解析 / 预热 哪一段
      st('下载 model.json');
      const mj = await (await fetch(url)).json();
      const base = url.replace(/[^/]*$/, ''), paths = mj.weightsManifest.flatMap(m => m.paths);
      for (let i = 0; i < paths.length; i++) {
        st(`下载权重 ${i + 1}/${paths.length}`);
        await (await fetch(base + paths[i])).arrayBuffer();
      }
      st('解析模型 loadGraphModel');
      const gm = await tf.loadGraphModel(url);
      st('预热推理(1/2) 创建输入');
      const shp = gm.inputs[0].shape, x = tf.zeros([1, shp[1], shp[2], 3], 'int32');
      st('预热推理(2/2) 执行并读回');
      const y = gm.execute(x); await y.data(); x.dispose(); y.dispose(); gm.dispose();
      st('创建 detector');
      const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType[type], modelUrl: url, enableSmoothing: true });
      st('模型就绪');
      return { estimate: async v => (await det.estimatePoses(v, { flipHorizontal: false }))[0] || null };
    };
  }

  // BlazePose 33 点 → COCO-17(+脚跟/脚尖)
  const BP = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const BP_TO = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  async function blaze() {
    st('加载 MediaPipe 脚本');
    const mod = await import(new URL('vendor/mediapipe/vision_bundle.mjs', document.baseURI).href);
    st('加载 wasm');
    const fileset = await mod.FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
    const make = delegate => mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: 'vendor/mediapipe/pose_landmarker_full.task', delegate },
      runningMode: 'VIDEO', numPoses: 1 });
    let lm; st('加载模型(GPU)');
    try { lm = await make('GPU'); } catch (e) { console.warn('GPU 委托失败，退回 CPU', e); st('GPU 失败，加载模型(CPU)'); lm = await make('CPU'); }
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

  const LIST = [
    { id: 'lightning', label: 'Lightning', load: movenet('SINGLEPOSE_LIGHTNING', 'vendor/movenet/model.json') },
    { id: 'thunder', label: 'Thunder', load: movenet('SINGLEPOSE_THUNDER', 'vendor/movenet-thunder/model.json') },
    { id: 'blaze', label: 'BlazePose', load: blaze },
  ];
  const cache = {};
  g.HR_MODELS = {
    list: LIST, stage: '', backend: '', log: [],
    load(id) {
      const m = LIST.find(x => x.id === id) || LIST[0];
      return cache[m.id] || (cache[m.id] = m.load().catch(e => { delete cache[m.id]; throw e; }));
    },
  };
})(window);
