// 数据库自动备份脚本（Windows / 跨平台通用，纯 Node 内置模块，无需额外依赖）
//
// 做的事：
//   1. 用 node:sqlite 的 VACUUM INTO 对运行中的 SQLite 做一致性热备份（含 WAL）
//   2. gzip 压缩，按时间戳命名写到 backups/
//   3. 删除超过 KEEP_DAYS 天的旧备份
//   4. 可选：复制到网盘同步文件夹，或用 rclone 上传到远端（夸克网盘走 AList WebDAV）
//
// 用法：
//   node scripts/backup-db.mjs
//
// 可用环境变量（都可不设，有默认值）：
//   DB_FILE          SQLite 文件路径，默认 ./prisma/data.db
//   BACKUP_DIR       本地备份目录，默认 ./backups
//   KEEP_DAYS        保留天数，默认 14
//   BACKUP_SYNC_DIR  网盘同步盘里的目标文件夹（OneDrive 等），设了就额外复制一份
//   RCLONE_REMOTE    rclone 远端路径，如 jianguoyun:fashion-backup，设了就调用 rclone copy 上传
//   RCLONE_BIN       rclone 可执行文件路径，默认用 PATH 里的 rclone
//   RCLONE_CONFIG    rclone 配置文件路径，默认用 rclone 自己的默认位置

import { DatabaseSync } from "node:sqlite";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const DB_FILE = process.env.DB_FILE ?? "./prisma/data.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const KEEP_DAYS = Number(process.env.KEEP_DAYS ?? "14");
const SYNC_DIR = process.env.BACKUP_SYNC_DIR ?? "";
const RCLONE_REMOTE = process.env.RCLONE_REMOTE ?? "";
const RCLONE_BIN = process.env.RCLONE_BIN ?? "rclone";
const RCLONE_CONFIG = process.env.RCLONE_CONFIG ?? "";

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  if (!existsSync(DB_FILE)) {
    throw new Error(`数据库文件不存在: ${path.resolve(DB_FILE)}`);
  }
  mkdirSync(BACKUP_DIR, { recursive: true });

  const tmpDb = path.join(BACKUP_DIR, `.tmp-${stamp()}.db`);
  const finalGz = path.join(BACKUP_DIR, `data-${stamp()}.db.gz`);

  // 1. 一致性热备份。VACUUM INTO 会生成一个干净的、整理过的副本，运行中也安全。
  const db = new DatabaseSync(DB_FILE);
  try {
    db.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  // 2. gzip 压缩
  await pipeline(createReadStream(tmpDb), createGzip({ level: 9 }), createWriteStream(finalGz));
  rmSync(tmpDb, { force: true });
  log(`已生成备份: ${finalGz} (${statSync(finalGz).size} 字节)`);

  // 3. 清理超过 KEEP_DAYS 天的旧备份
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of readdirSync(BACKUP_DIR)) {
    if (!/^data-\d{8}_\d{4}\.db\.gz$/.test(name)) continue;
    const full = path.join(BACKUP_DIR, name);
    if (statSync(full).mtimeMs < cutoff) {
      rmSync(full, { force: true });
      removed++;
    }
  }
  if (removed) log(`已清理 ${removed} 个超过 ${KEEP_DAYS} 天的旧备份`);

  // 4a. 复制到网盘同步文件夹（OneDrive / 坚果云客户端等）
  if (SYNC_DIR) {
    mkdirSync(SYNC_DIR, { recursive: true });
    const dest = path.join(SYNC_DIR, path.basename(finalGz));
    copyFileSync(finalGz, dest);
    log(`已复制到同步盘: ${dest}`);
  }

  // 4b. rclone 上传到远端（坚果云 WebDAV / S3 / OSS 等）
  if (RCLONE_REMOTE) {
    const args = [];
    if (RCLONE_CONFIG) args.push("--config", RCLONE_CONFIG);
    args.push("copy", finalGz, RCLONE_REMOTE, "--progress");
    // 给了完整路径就直接 spawn（参数安全转义）；只有用 PATH 里的裸 "rclone"
    // 时才在 Windows 上借 shell 解析 PATHEXT。
    const needShell = process.platform === "win32" && !/[\\/]/.test(RCLONE_BIN);
    const r = spawnSync(RCLONE_BIN, args, { stdio: "inherit", shell: needShell });
    if (r.status !== 0) {
      throw new Error(`rclone 上传失败，退出码 ${r.status}`);
    }
    log(`已通过 rclone 上传到 ${RCLONE_REMOTE}`);
  }

  log("备份完成");
}

main().catch((err) => {
  log(`备份失败: ${err.message}`);
  process.exit(1);
});
