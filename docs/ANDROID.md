# Nudge 安卓 App（Capacitor）

## PWA 是什么？（对比）

| | **PWA** | **安卓 APK（本方案）** |
|--|---------|----------------------|
| 是什么 | 网页 +「添加到主屏幕」 | 真正的安装包 `.apk` |
| 怎么装 | Chrome 菜单 → 安装应用 / 添加到主屏幕 | 安装 APK 或以后上架应用商店 |
| 要不要打包 | 不用 | 用 Capacitor 包一层 WebView |
| 推送 | 浏览器限制多（尤其 iOS） | 可后续加系统通知；目前提醒仍走飞书 |

本仓库当前做的是 **安卓 APK**：手机里打开全屏 WebView，加载 VPS 上的 Nudge（`http://49.235.172.214:9999`）。

---

## 环境准备（只需一次）

1. 安装 [Android Studio](https://developer.android.com/studio)（自带 Android SDK）
2. 打开 Android Studio → **More Actions → SDK Manager**，确保已装：
   - Android SDK Platform 34（或提示的版本）
   - Android SDK Build-Tools
3. 设置环境变量（PowerShell 示例，路径按本机 SDK 改）：

```powershell
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

4. 本机已有 Java 21 即可。

---

## 生成 / 同步安卓工程

在项目根目录：

```bash
npm install
npm run mobile:sync
```

首次会生成 `android/` 目录。之后改了 `capacitor.config.json` 或 `www/` 再执行一次 `mobile:sync`。

用 Android Studio 打开 `android/` 文件夹，连真机或模拟器点 Run。

---

## 打调试 APK（可直接装手机）

```bash
npm run mobile:apk
```

成功后文件大致在：

`android/app/build/outputs/apk/debug/app-debug.apk`

用数据线拷到手机安装（需允许「未知来源」）。

---

## 改服务器地址

编辑 `capacitor.config.json`：

```json
"server": {
  "url": "http://你的服务器:端口",
  "cleartext": true
}
```

若以后换成 **HTTPS 域名**，可把 `cleartext` 改为 `false`。改完后：

```bash
npm run mobile:sync
npm run mobile:apk
```

---

## 网页更新 vs 重打 APK

| 改动类型 | 要不要重打 APK |
|----------|----------------|
| 服务器上的网页 / API（push 部署） | **不用**。设置 →「检查并更新」，或按启动提示更新 |
| `capacitor.config.json` 的 server.url、图标、原生插件 | **要** `mobile:sync` + `mobile:apk` |

若更新后仍旧：设置里点「强制刷新」；仍不行再清 App 存储或重装。

---

## 注意

- 手机必须能访问该 URL（同一局域网 / 公网端口已放行）。
- 登录账号与网页相同（默认 `admin` / `admin123`，生产请改密）。
- 确认事项仍在飞书卡片点「已收到」；App 内主要是管理清单与查看今日。
