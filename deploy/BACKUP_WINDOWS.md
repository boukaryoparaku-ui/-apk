# Windows 自动备份到网盘（坚果云 WebDAV）

本系统数据是单个 SQLite 文件 `prisma/data.db`，备份它就等于备份全部业务数据
（账号、SKU、采购入库、销售出库、库存、库存流水等）。

自动备份链路：

```
data.db ──热备份+gzip──> backups/data-YYYYMMDD_HHMM.db.gz ──上传──> 网盘
         (scripts/backup-db.mjs)                          (任务计划每天触发)
```

热备份用 Node 内置 `node:sqlite` 的 `VACUUM INTO`，运行中也能安全备份，无需停服、无需额外装 sqlite3。

---

## 第 1 步：先确认本地备份能跑

```bash
npm run backup
```

会在 `backups/` 下生成 `data-时间戳.db.gz`，并自动清理超过 14 天的旧备份。
只要这步成功，本地备份就已经可用了。

---

## 第 2 步：上传到坚果云（rclone + WebDAV）

坚果云提供**官方 WebDAV**，rclone 直连，不需要客户端、不需要 AList，是个人用最干净的方案。
rclone 已经下好放在 `tools\rclone.exe`。

### 2.1 拿到坚果云"应用密码"

1. 登录坚果云网页版 → 右上角账户 → 「账户信息」→「安全选项」。
2. 「第三方应用管理」→「添加应用密码」，名称随便填（如 `backup`），生成一串密码。
3. 记下这串**应用密码**（注意：不是你的登录密码，WebDAV 只认应用密码）。

坚果云 WebDAV 固定信息：
- 地址：`https://dav.jianguoyun.com/dav/`
- 账号：你的坚果云登录邮箱
- 密码：上面生成的应用密码

### 2.2 一次性配置 rclone 远端

直接跑配置脚本，按提示填邮箱和应用密码：

```
deploy\setup-jianguoyun.bat
```

脚本会把远端写进 `tools\rclone.conf`，并测试连通（能列出你坚果云里的文件夹就成功）。
然后建一个备份目录：

```
tools\rclone.exe --config tools\rclone.conf mkdir jianguoyun:fashion-backup
```

> 应用密码可随时在坚果云后台吊销重发，泄露风险低。`tools\rclone.conf` 已加入 .gitignore。

---

## 第 3 步：让备份脚本自动上传

编辑 `deploy\backup.bat`，去掉路线 B 那 3 行的 `REM`：

```bat
set "RCLONE_BIN=%~dp0\..\tools\rclone.exe"
set "RCLONE_CONFIG=%~dp0\..\tools\rclone.conf"
set "RCLONE_REMOTE=jianguoyun:fashion-backup"
```

再跑一次 `deploy\backup.bat`，日志（`logs\backup.log`）出现 “已通过 rclone 上传到 ...” 即成功，
坚果云 `fashion-backup` 目录下会出现 `data-时间戳.db.gz`。

> 换别的后端（阿里云 OSS / S3 / R2 等）也是同一套：`rclone config` 配好对应远端，
> 把 `RCLONE_REMOTE` 改成那个远端路径即可，脚本不用动。

---

## 第 4 步：用任务计划程序每天自动跑

1. Win 搜索「任务计划程序」打开。
2. 右侧「创建任务」（不是“创建基本任务”，这样能配“不登录也运行”）。
   - 常规：勾选「不管用户是否登录都要运行」+「使用最高权限运行」。
   - 触发器：新建 → 每天 → 凌晨 2:00（避开使用高峰）。
   - 操作：新建 → 程序或脚本填：
     ```
     C:\Users\17553\Documents\dooker-copy-20260525-204407\deploy\backup.bat
     ```
   - 条件：按需取消「只在交流电源时运行」。
3. 保存后右键该任务「运行」测一次，检查 `logs\backup.log` 和夸克里是否出现新备份。

---

## 还原数据

需要恢复时：

1. 把某个 `data-时间戳.db.gz` 解压成 `data.db`（任意解压工具，或 `gzip -d`）。
2. 停掉本系统服务。
3. 用解压出的 `data.db` 覆盖 `prisma\data.db`。
4. 重启服务。

---

## 备份策略建议

- `backups/` 默认保留 14 天，按需改 `backup.bat` 里的 `KEEP_DAYS`。
- 至少保证“本地一份 + 网盘一份”，别只放本地，硬盘坏了就全没了。
- 重要节点（盘点前、批量改数据前）可手动 `npm run backup` 留一份。
