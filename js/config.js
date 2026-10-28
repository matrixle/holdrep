/* Hold Rep 识别参数（集中配置）
 * 角度单位：度；长度类阈值均以「身体单位 unit」归一化（≈ 肩宽），因此与人离镜头远近无关；
 * 时间单位：毫秒。识别不准时优先调整这里。 */
window.HR_CONFIG = {
  // ---- 通用 ----
  DETECT_INTERVAL_MS: 50,       // 推理最小间隔（≈20fps），卡顿可调大
  MIN_KP_SCORE: 0.3,            // 关键点置信度下限
  MAX_FRAME_GAP_MS: 1200,       // 两帧间隔超过此值（切后台/卡死）视为中断
  SHOW_SKELETON: true,          // 是否在画面上绘制骨架辅助调试
  HEALTH_SHORTCUT: 'HoldRep 写入健康', // 写入苹果健康所用的快捷指令名称（需在「快捷指令」App 中按 README 建好）

  // ---- Dead Hang ----
  HANG_ANGLE_ENTER: 155,        // 进入悬垂：肘角需 ≥ 此值（手臂伸直）
  HANG_ANGLE_HOLD: 140,         // 已在悬垂中：肘角 ≥ 此值即保持（迟滞，防抖）
  HANG_WRIST_ABOVE: 0.8,        // 手腕需高于肩膀多少个 unit（排除手放下）
  HANG_REQUIRE_BOTH_ARMS: false,// true=必须两只手臂都被识别到
  HANG_MAX_SWING_SPEED: 1.5,    // 肩部移动速度上限（unit/秒），超过视为非静止（如跳上杠）
  HANG_REQUIRE_FEET_OFF_GROUND: true, // 必须脚离地才计时（需先站立校准地面，见 detectors.js）
  HANG_FEET_HOLD_RATIO: 0.8,    // 已在悬垂中时，离地门槛 = HANG_FEET_LIFT × 此值（防抖）
  HANG_FEET_LIFT: 0.28,         // 脚踝比站立校准位置高出多少 unit 才算离地。
                                // 实测（BlazePose，低杠）：直腿悬垂脚刚离地 ≈0.35，屈膝悬垂 ≈0.9，
                                // 握杠踮脚站立 ≈0.2，握杠平脚站立 ≈0。取 0.28 区分「踮脚」与「刚离地」。
                                // 踮脚仍被计时 → 调大；直腿悬垂不计时 → 调小。训练页顶部标签的 ↑数值 即当前离地高度。
  HANG_ENTER_MS: 400,           // 姿势持续多久才开始计时（计时会回溯补上）
  HANG_EXIT_MS: 700,            // 姿势丢失多久才判定中断（短暂丢失不会中断）
  HANG_MIN_SEGMENT_MS: 1000,    // 短于此的悬挂段视为误触，丢弃

  // ---- Pull-up / Chin-up ----
  PULLUP_START_ANGLE: 140,      // 起始/回落位：肘角 ≥ 此值视为手臂伸直（宽松：不必完全锁死）
  PULLUP_WRIST_ABOVE: 0.8,      // 起始位手腕需高于肩 unit 数
  PULLUP_CHIN_OFFSET: 0.3,      // 鼻子到下巴的距离（unit），用鼻子估算下巴
  PULLUP_CHIN_MARGIN: 0.5,      // 下巴距杠不超过多少 unit 即算到顶（0=必须过杠；越大越宽松）
  PULLUP_TOP_ELBOW_ANGLE: 100,  // 或：肘角 ≤ 此值（手臂明显弯曲）也算到顶；设为 0 关闭此条件
  // 身体必须真的被拉上去（防止坐着 / 站着举手屈伸也被计数）：引体时手腕握杠不动、肩膀上升；
  // 坐着屈伸手臂则相反，肩膀不动、手腕下落。两者手臂角度变化一样，所以比较「肩膀上升」与「手腕偏离杠」。
  PULLUP_MIN_RISE: 0.25,        // 到顶时肩膀至少比底部高出多少 unit
  PULLUP_RISE_RATIO: 2,         // 且肩膀上升量 ≥ 手腕偏离杠高度 × 此倍数
  PULLUP_START_FRAMES: 3,       // 连续多少帧在起始位才确认
  PULLUP_TOP_FRAMES: 2,         // 连续多少帧下巴过杠才确认到顶
  PULLUP_LOST_PAUSE_MS: 2500,   // 人离开画面多久自动暂停
  PULLUP_OUT_OF_START_PAUSE_MS: 9000, // 离开起始位多久自动暂停（单次动作最长耗时）
  GROUP_GAP_MS: 15000,

  // ---- 动作分析报告（结果页「动作分析」，规则见 report.js；长度单位 unit ≈ 肩宽）----
  AN_LOCKOUT: 160,              // 引体底部肘角 < 此值 = 未伸直（专业标准接近完全伸直）
  AN_PU_FULL_EXT: 155,          // 下放计时终点：回到底部后肘角首次 ≥ 此值
  AN_PU_SHRUG: 0.05,            // 顶部耳-肩距离比底部还小超过此值 = 顶部耸肩（肩胛未下沉）
  AN_PU_CRANE: 0.15,            // 顶部鼻子相对耳朵抬高超过此值 = 伸脖子够杠
  AN_PU_HIPFLEX: 25,            // 单次中髋角减小超过（度）= 抬腿 / 屈髋借力（3D）
  AN_PU_KNEEFLEX: 35,           // 单次中膝角减小超过（度）= 蹬腿（3D）
  AN_PU_ANKZ: 0.15,             // 单次中脚前后摆幅超过（米）= 摆荡（3D）
  AN_PU_LEAN: 15,               // 单次中躯干前后摆动超过（度）（3D）
  AN_PU_LEG_DRIVE: 0.3,         // 无 3D 时：膝盖相对髋部抬高超过（unit）
  AN_PU_SWAY: 0.3,              // 单次中髋部横向移动超过（unit）
  AN_PU_ECC_MIN_MS: 1000,       // 下放 < 此值 = 过快
  AN_PU_ECC_GOOD_MS: 2000,      // 下放 ≥ 此值 = 控制良好
  AN_PU_VLOSS: 0.4,             // 速度损失（后两次 vs 最快）超过 = 已明显疲劳
  AN_HANG_ELBOW_OK: 165,        // 悬垂平均肘角 ≥ 此值 = 手臂伸直
  AN_HANG_ELBOW_WARN: 150,      // < 此值 = 明显屈臂
  AN_HANG_SPEED: 0.35,          // 悬垂中平均肩速（unit/秒）超过 = 晃动
  AN_HANG_SWAY: 0.08,           // 悬垂中髋部横向位置标准差超过 = 左右摆
  AN_HANG_LEAN_SD: 5,           // 悬垂中躯干前后倾角标准差超过（度）= 前后摆（3D）
  AN_HANG_ANKZ_SD: 0.05,        // 悬垂中脚前后位置标准差超过（米）= 腿前后摆（3D）
  AN_HANG_SHRUG: 0.08,          // 段尾比段首耳-肩距离缩短超过 = 转为被动悬垂
  AN_HANG_TREMOR: 2.0,          // 后 1/4 晃动是前 1/4 的几倍以上 = 疲劳抖动
  AN_TILT: 0.08,                // 左右肩高差（平均）超过 = 身体侧倾
  AN_ELBOW_DIFF: 10,            // 左右肘角差（度）超过 = 两臂不对称
  AN_ROT: 0.25,                 // 躯干扭转（两肩前后差 / 肩宽）超过（3D）
  AN_GRIP_NARROW: 1.0,          // 握距 < 此倍肩宽 = 窄握
  AN_GRIP_WIDE: 2.0,            // 握距 > 此倍肩宽 = 过宽（肩部压力大）
  AN_PALM_SIGN: 1,              // 掌心判据符号：正值 = 正握（若实测反握被识别成正握，改为 -1）

  // ---- 热量估算（写入苹果健康的「大卡」= 活动能量，需在首页填体重）----
  // 大卡 = (MET − 1) × 体重kg × 小时；减 1 是扣掉静息代谢，与「健康」里「活动能量」口径一致
  KCAL_HANG_MET: 3.5,           // Dead Hang 悬挂中（上肢等长发力）
  KCAL_PULLUP_MET: 8.0,         // 引体向上发力中（徒手训练·剧烈，Compendium 02020）
  KCAL_PULLUP_REP_SEC: 3,       // 每次引体按多少秒发力时间计
  KCAL_REST_MET: 1.3,           // 组间休息 / 站立等待          // 两次 rep 间隔超过此值，拆为新的一组
};
