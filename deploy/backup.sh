#!/bin/sh
# 每日备份 SQLite 数据库文件，并自动清理旧备份。
#
# 用法：
#   1. chmod +x deploy/backup.sh
#   2. 改下面的 DB_FILE / BACKUP_DIR 为你的实际路径
#   3. 加到 crontab，每天凌晨 2 点跑：
#        crontab -e
#        0 2 * * * /opt/fashion-inventory/deploy/backup.sh >> /var/log/fashion-backup.log 2>&1
#
# 强烈建议再把 BACKUP_DIR 同步到另一台机器/NAS/对象存储。

set -e

# SQLite 数据库文件路径（对应 .env 里的 DATABASE_URL=file:... 指向的文件）
DB_FILE="/opt/fashion-inventory/prisma/data.db"
BACKUP_DIR="/opt/fashion-inventory/backups"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F_%H%M)
OUT="$BACKUP_DIR/data-${STAMP}.db"

if command -v sqlite3 >/dev/null 2>&1; then
  # 优先用 sqlite3 的在线备份，运行中也能安全备份（含 WAL）
  sqlite3 "$DB_FILE" ".backup '$OUT'"
else
  # 没有 sqlite3 命令时退化为文件复制（低并发场景足够，建议低峰期执行）
  cp "$DB_FILE" "$OUT"
fi

gzip -f "$OUT"
echo "[$(date)] backup written: ${OUT}.gz"

# 删除超过 KEEP_DAYS 天的旧备份
find "$BACKUP_DIR" -name "data-*.db.gz" -mtime +${KEEP_DAYS} -delete
echo "[$(date)] old backups older than ${KEEP_DAYS}d cleaned"
