# Hold Rep — 单杠自动计时 / 计数 PWA

纯 HTML/CSS/原生 JS，无构建、无 npm。姿态识别使用 MediaPipe BlazePose（模型与 wasm 已放在 `vendor/`），首次加载后完全离线可用。

## 目录
- `index.html` `css/app.css` `js/{config,detectors,db,app}.js` — 应用
- `js/config.js` — **所有识别阈值集中在这里**
- `manifest.webmanifest` `sw.js` `icons/` — PWA
- `vendor/mediapipe/` — MediaPipe Tasks Vision 脚本、wasm、BlazePose Full 模型（本地，约 22MB）
- `serve.py` — 本地静态服务器

## ⚠️ 重要：必须是 HTTPS
iOS Safari 只在 **HTTPS**（或 localhost）下允许调用摄像头、注册 Service Worker。iPhone 访问电脑的 `http://192.168.x.x` 不行。两种办法任选：

### 方案 A：免费静态托管（最省事）
把整个目录上传到 GitHub Pages / Cloudflare Pages / Netlify（拖拽即可，无需服务器、无需开发者账号）。得到 `https://…` 地址后按下面步骤安装。之后应用完全离线，托管站点可随时下线。

### 方案 B：局域网 + mkcert
```bash
brew install mkcert && mkcert -install
mkcert 192.168.x.x            # 换成电脑的局域网 IP，生成 *.pem
python3 serve.py 192.168.x.x.pem 192.168.x.x-key.pem
```
再把 mkcert 根证书（`mkcert -CAROOT` 下的 rootCA.pem）AirDrop 到 iPhone → 设置 › 通用 › VPN 与设备管理 安装 → 设置 › 通用 › 关于本机 › 证书信任设置 里启用完全信任。然后 iPhone Safari 打开 `https://192.168.x.x:8443`。

## iPhone 安装步骤
1. 在 iPhone **Safari** 打开应用 HTTPS 地址，首次进入训练页时按系统提示**允许摄像头**（被拒绝可到 设置 › Safari › 摄像头 改为「询问/允许」）。先进入一次训练页，让模型被缓存。
2. 点 Safari 底部「分享」按钮（方框带向上箭头）。
3. 菜单向下滑，选「添加到主屏幕」。
4. 确认名称为「Hold Rep」，点右上角「添加」。
5. 之后点主屏幕图标即可全屏启动，无网络也能用。

> 从主屏幕启动的 PWA 摄像头权限可能需要再允许一次，属 iOS 正常行为。

## 识别模型
使用 MediaPipe BlazePose Full（GPU 推理）。曾对比 MoveNet Lightning / Thunder，实测 BlazePose 在 Dead Hang 上最准，已移除其他模型。训练页右上角小标签显示模型、离地高度 ↑ 与单次推理耗时。模型约 22MB，首次进入训练页时下载并缓存到独立缓存中，之后离线可用，**更新 App 版本不会重新下载**。国内访问 github.io 可能较慢，请在 Wi-Fi 下耐心等待首次下载。

## 大字显示
类似 iOS 秒表：居中的超大细体数字（`mm:ss.cc`，毫秒位在两次识别之间插值，走得顺滑），画面压暗以便远距离看清。首页「数字显示」或训练页右上角「Aa」可切换，默认开启，选择会被记住。

## 使用
手机竖屏立在前方，前置摄像头拍到上半身和单杠，屏幕上橙色虚线为估计的单杠高度（需先在起始位悬垂一下）。
- **Dead Hang**：手臂伸直、手腕高于肩、**双脚离地**、身体基本静止 → 自动计时；
  脚是否离地靠「地面校准」判断：进入训练页后先**双脚着地、双手放下站一下**（画面里需拍到脚踝或膝盖），之后**两只**脚踝都比各自站立位置高出 `HANG_FEET_LIFT`（默认 0.28 肩宽）才算离地，可区分「握杠踮脚」与「真正离地」。顶部提示条会告诉你当前状态。相机位置变动后，重新放下手站一下即可自动更新。不需要时可把 `HANG_REQUIRE_FEET_OFF_GROUND` 设为 false。
  姿势丢失 0.7s 以上自动暂停，回到悬垂接续。
- **引体**：手臂基本伸直（起始位）→ 拉起到「下巴接近杠」或「手臂明显弯曲」→ 回到基本伸直 = 1 次（判定已放宽）。离开画面 2.5s / 离开起始位 9s 自动暂停，次数保留。两次间隔 >15s 自动分组。
- 结束本轮时会自动保存到历史（结果页「保存到历史」显示为已保存）；历史里可查看明细并删除（二次确认）。
- 报表：总览指标 + 近 7 / 30 天每日趋势。

## 写入苹果健康

网页 / PWA 无法直接访问 HealthKit，所以借助 iOS「快捷指令」：结果页（或历史详情）点 **❤︎ 写入苹果健康**，App 会把本轮数据交给名为 **`HoldRep 写入健康`** 的快捷指令，由它在「健康」里记录一次体能训练。

传入的是 JSON 文本，例如 `{"seconds":85,"start":"2026-10-28 10:30:05"}`：`seconds` 为本轮用时（秒），`start` 为开始时间（本地时间）。

**一次性设置：**「快捷指令」App → ＋，重命名为 `HoldRep 写入健康`（一字不差，中间有空格），依次添加：

1. **从输入中获取词典** — 输入：快捷指令输入
2. **获取词典值** — 获取「词典」中 `seconds` 的值
3. **获取词典值** — 获取第 1 步「词典」中 `start` 的值
4. **从输入中获取日期** — 输入：第 3 步的「词典值」
5. **记录体能训练**（搜「体能训练」）：
   - 类型：功能性力量训练
   - 日期：第 4 步的「日期」
   - 持续时间：第 2 步的「词典值」，单位 **秒**
   - **大卡、距离必须填值**（留空会报错），都填 `0` 即可

第一次写入时 iOS 会请求「健康」权限，选允许。App 无法得知快捷指令是否成功，按钮只标记「已发送」；重复点击会重复写入。快捷指令运行完后从左上角返回 Hold Rep。

## 调参
改 `js/config.js` 后，运行 `./bump.sh` 刷新缓存版本。常见问题：
- 悬垂不计时 → 降低 `HANG_ANGLE_ENTER`、`HANG_WRIST_ABOVE`，或调大 `HANG_MAX_SWING_SPEED`
- 引体漏计 → 增大 `PULLUP_CHIN_MARGIN` 或增大 `PULLUP_TOP_ELBOW_ANGLE`；回落不算 → 降低 `PULLUP_START_ANGLE`
- 手机发热/卡顿 → 增大 `DETECT_INTERVAL_MS`，或 `SHOW_SKELETON:false`

发布前运行 `./bump.sh`（自动递增 `js/version.js` 的版本号并写入时间，`sw.js` 缓存名同步使用它），首页底部会显示「版本 · 更新于 · 缓存」，用来确认手机是否已是最新版。
