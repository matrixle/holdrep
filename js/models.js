/* 姿态模型：MediaPipe BlazePose（默认 Heavy，精度最高；可在「设置」页切换为 Full，更快）。
 * 统一接口：estimate(video) -> { keypoints: [{x,y,score}], world: [{x,y,z}] } | null
 * keypoints：像素坐标，COCO 顺序 0 鼻 3/4 左右耳 5/6 肩 7/8 肘 9/10 腕 11/12 髋 13/14 膝 15/16 踝，
 *            另加 17/18 左右小指根、19/20 左右食指根（判断握法）。
 * world：同序号的 3D 世界坐标（米，原点在髋部中点，y 向下，z 越小越靠近镜头），用于前后摆动、躯干后仰等 2D 看不到的动作。 */
(function (g) {
  'use strict';
  const T0 = performance.now();
  const st = t => { // 当前阶段 + 带时间戳的日志（超时时显示在屏幕上，也输出到控制台）
    g.HR_MODELS.stage = t;
    const line = ((performance.now() - T0) / 1000).toFixed(1) + 's ' + t;
    g.HR_MODELS.log.push(line); console.log('[HR]', line);
  };

  const VARIANTS = { heavy: { label: 'BlazePose Heavy', file: 'pose_landmarker_heavy.task' }, full: { label: 'BlazePose Full', file: 'pose_landmarker_full.task' } };
  const getVariant = () => { try { return VARIANTS[localStorage.getItem('hr_pose')] ? localStorage.getItem('hr_pose') : 'heavy'; } catch (e) { return 'heavy'; } };

  // BlazePose 33 点 → 上面的序号
  const BP = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 17, 18, 19, 20];
  const BP_TO = [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  async function blaze(v) {
    st('加载 MediaPipe 脚本');
    const mod = await import(new URL('vendor/mediapipe/vision_bundle.mjs', document.baseURI).href);
    st('加载 wasm');
    const fileset = await mod.FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
    const make = delegate => mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: 'vendor/mediapipe/' + VARIANTS[v].file, delegate },
      runningMode: 'VIDEO', numPoses: 1 });
    let lm; st(`加载模型 ${VARIANTS[v].label}(GPU)`);
    try { lm = await make('GPU'); g.HR_MODELS.backend = 'GPU'; }
    catch (e) { console.warn('GPU 委托失败，退回 CPU', e); st('GPU 失败，加载模型(CPU)'); lm = await make('CPU'); g.HR_MODELS.backend = 'CPU'; }
    st('模型就绪');
    let lastTs = 0;
    return { estimate: async vid => {
      const ts = Math.max(performance.now(), lastTs + 1); lastTs = ts;
      const res = lm.detectForVideo(vid, ts), p = res.landmarks && res.landmarks[0], w = res.worldLandmarks && res.worldLandmarks[0];
      if (!p) return null;
      const W = vid.videoWidth, H = vid.videoHeight, kps = [], world = w ? [] : null;
      BP.forEach((src, i) => {
        const l = p[src], to = BP_TO[i];
        kps[to] = { x: l.x * W, y: l.y * H, score: l.visibility == null ? 1 : l.visibility };
        if (w) world[to] = { x: w[src].x, y: w[src].y, z: w[src].z };
      });
      return { keypoints: kps, world };
    } };
  }

  let cache = null;
  g.HR_MODELS = {
    get label() { return VARIANTS[getVariant()].label; }, stage: '', backend: '', log: [],
    variant: getVariant,
    setVariant(v) { try { localStorage.setItem('hr_pose', v); } catch (e) {} cache = null; },
    load() { return cache || (cache = blaze(getVariant()).catch(e => { cache = null; throw e; })); },
  };
})(window);
