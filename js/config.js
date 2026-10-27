/* Hold Rep 识别参数（集中配置）
 * 角度单位：度；长度类阈值均以「身体单位 unit」归一化（≈ 肩宽），因此与人离镜头远近无关；
 * 时间单位：毫秒。识别不准时优先调整这里。 */
window.HR_CONFIG = {
  // ---- 通用 ----
  DETECT_INTERVAL_MS: 50,       // 推理最小间隔（≈20fps），卡顿可调大
  MIN_KP_SCORE: 0.3,            // 关键点置信度下限
  MAX_FRAME_GAP_MS: 1200,       // 两帧间隔超过此值（切后台/卡死）视为中断
  SHOW_SKELETON: true,          // 是否在画面上绘制骨架辅助调试

  // ---- Dead Hang ----
  HANG_ANGLE_ENTER: 155,        // 进入悬垂：肘角需 ≥ 此值（手臂伸直）
  HANG_ANGLE_HOLD: 140,         // 已在悬垂中：肘角 ≥ 此值即保持（迟滞，防抖）
  HANG_WRIST_ABOVE: 0.8,        // 手腕需高于肩膀多少个 unit（排除手放下）
  HANG_REQUIRE_BOTH_ARMS: false,// true=必须两只手臂都被识别到
  HANG_MAX_SWING_SPEED: 1.5,    // 肩部移动速度上限（unit/秒），超过视为非静止（如跳上杠）
  HANG_REQUIRE_FEET_OFF_GROUND: true, // 必须脚离地才计时（需先站立校准地面，见 detectors.js）
  HANG_FEET_LIFT: 0.1,          // 脚踝/膝盖比站立校准位置高出多少 unit 才算离地（≈肩宽×0.1，约 4cm；杠低时可再调小，误判时调大）
  HANG_ENTER_MS: 400,           // 姿势持续多久才开始计时（计时会回溯补上）
  HANG_EXIT_MS: 700,            // 姿势丢失多久才判定中断（短暂丢失不会中断）
  HANG_MIN_SEGMENT_MS: 1000,    // 短于此的悬挂段视为误触，丢弃

  // ---- Pull-up / Chin-up ----
  PULLUP_START_ANGLE: 140,      // 起始/回落位：肘角 ≥ 此值视为手臂伸直（宽松：不必完全锁死）
  PULLUP_WRIST_ABOVE: 0.8,      // 起始位手腕需高于肩 unit 数
  PULLUP_CHIN_OFFSET: 0.3,      // 鼻子到下巴的距离（unit），用鼻子估算下巴
  PULLUP_CHIN_MARGIN: 0.5,      // 下巴距杠不超过多少 unit 即算到顶（0=必须过杠；越大越宽松）
  PULLUP_TOP_ELBOW_ANGLE: 100,  // 或：肘角 ≤ 此值（手臂明显弯曲）也算到顶；设为 0 关闭此条件
  PULLUP_START_FRAMES: 3,       // 连续多少帧在起始位才确认
  PULLUP_TOP_FRAMES: 2,         // 连续多少帧下巴过杠才确认到顶
  PULLUP_LOST_PAUSE_MS: 2500,   // 人离开画面多久自动暂停
  PULLUP_OUT_OF_START_PAUSE_MS: 9000, // 离开起始位多久自动暂停（单次动作最长耗时）
  GROUP_GAP_MS: 15000,          // 两次 rep 间隔超过此值，拆为新的一组
};
