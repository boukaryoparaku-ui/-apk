# 服装供销存 · 安卓客户端（Capacitor 远程壳）

这是一个轻量安卓客户端。它本身**不包含业务代码**，而是一个原生外壳：打开后让你填写服务器地址，然后用内置浏览器加载你现有的 Web 系统。登录、库存、入库、开单等所有功能与浏览器访问完全一致。

- 后端：**零改动**，继续用现有 Express + SQLite 服务。
- 认证：沿用现有 session cookie（已确认 `secure:false`、`sameSite:lax`，局域网 http 下可用）。
- 换服务器 IP：在 App 内重新填地址即可，**不用重新打包**。

## 一、使用方式

1. 安装 APK 后打开 App，首次进入会要求填服务器地址。
2. 填写后端地址，例如 `http://192.168.1.10:3000`（手机需与服务器同一局域网）。
3. 点「保存并连接」，之后就是熟悉的登录页。
4. 地址保存在手机本地，下次打开自动连接（约 2 秒倒计时，可点「立即进入」或「更换服务器地址」）。

> 怎么查服务器局域网 IP：在运行后端的电脑上执行 `ipconfig`（Windows），找「IPv4 地址」，一般是 `192.168.x.x`。端口默认 `3000`（脱离 Docker）或 `3001`（Docker）。

## 二、云端构建 APK（推荐，本地不装任何环境）

已配好 GitHub Actions 工作流 `.github/workflows/android.yml`。

1. 把本仓库推到 GitHub（仓库根目录，包含 `mobile/` 和 `.github/`）。
2. 进入 GitHub 仓库页 → **Actions** 标签页。
3. 选 **Build Android APK** → 点 **Run workflow**（或推送任意改动到 `main`/`master` 触发）。
4. 构建完成后，在该次运行页面底部 **Artifacts** 下载 `dooker-inventory-debug-apk`。
5. 解压得到 `app-debug.apk`，传到手机安装（需允许「未知来源」安装）。

构建产出的是 **debug 包**，可直接安装自用。对外分发或上架需要再做签名（见下方第四节）。

## 三、本地构建（可选，需 Android Studio + JDK 21）

```bash
cd mobile
npm install
npx cap add android      # 首次生成 android/ 原生工程
npx cap sync android
cd android
./gradlew assembleDebug  # Windows: gradlew.bat assembleDebug
```

产物路径：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## 四、签名发布（可选）

debug 包用于自用足够。若要正式分发：

1. 用 `keytool` 生成 keystore。
2. 在 `android/app/build.gradle` 配置 `signingConfigs` 并对 `release` 生效。
3. 运行 `./gradlew assembleRelease`。

需要时我可以帮你把签名配置加进云构建流程（用 GitHub Secrets 存 keystore）。

## 五、常见问题

- **连不上 / 一直转圈**：确认手机和服务器同一 WiFi；浏览器先在手机上访问 `http://服务器IP:端口` 能打开，再用 App。
- **登录后被登出**：检查后端 `SESSION_SECRET` 是否稳定；session 默认有效期 12 小时。
- **想换服务器**：App 启动倒计时界面点「更换服务器地址」，或清除 App 数据后重填。
