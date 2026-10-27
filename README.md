# Hold Rep — 单杠自动计时 / 计数 PWA

纯 HTML/CSS/原生 JS，无构建、无 npm。TensorFlow.js 与 MoveNet Lightning 模型已放在 `vendor/`，首次加载后完全离线可用。

## 目录
- `index.html` `css/app.css` `js/{config,detectors,db,app}.js` — 应用
- `js/config.js` — **所有识别阈值集中在这里**
- `manifest.webmanifest` `sw.js` `icons/` — PWA
- `vendor/` — tf.min.js、pose-detection、MoveNet 模型（本地）
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

## 使用
手机竖屏立在前方，前置摄像头拍到上半身和单杠，屏幕上橙色虚线为估计的单杠高度（需先在起始位悬垂一下）。
- **Dead Hang**：手臂伸直、手腕高于肩、**双脚离地**、身体基本静止 → 自动计时；
  脚是否离地靠「地面校准」判断：进入训练页后先**双脚着地、双手放下站一下**（画面里需拍到脚踝或膝盖），之后脚踝比站立位置高出 `HANG_FEET_LIFT` 才算离地。顶部提示条会告诉你当前状态。相机位置变动后，重新放下手站一下即可自动更新。不需要时可把 `HANG_REQUIRE_FEET_OFF_GROUND` 设为 false。
  姿势丢失 0.7s 以上自动暂停，回到悬垂接续。
- **引体**：手臂基本伸直（起始位）→ 拉起到「下巴接近杠」或「手臂明显弯曲」→ 回到基本伸直 = 1 次（判定已放宽）。离开画面 2.5s / 离开起始位 9s 自动暂停，次数保留。两次间隔 >15s 自动分组。
- 结束本轮时会自动保存到历史（结果页「保存到历史」显示为已保存）；历史里可查看明细并删除（二次确认）。
- 报表：总览指标 + 近 7 / 30 天每日趋势。

## 调参
改 `js/config.js` 后，把 `sw.js` 的 `VERSION` 加一（如 `holdrep-v2`）以刷新缓存。常见问题：
- 悬垂不计时 → 降低 `HANG_ANGLE_ENTER`、`HANG_WRIST_ABOVE`，或调大 `HANG_MAX_SWING_SPEED`
- 引体漏计 → 增大 `PULLUP_CHIN_MARGIN` 或增大 `PULLUP_TOP_ELBOW_ANGLE`；回落不算 → 降低 `PULLUP_START_ANGLE`
- 手机发热/卡顿 → 增大 `DETECT_INTERVAL_MS`，或 `SHOW_SKELETON:false`

更新应用文件后记得递增 `sw.js` 的 `VERSION`。
