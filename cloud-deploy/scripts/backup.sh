#!/bin/bash
# 数据库备份脚本 - 支持 Docker 和 systemd 两种部署方式
#
# 用法:
#   ./backup.sh docker    # Docker 部署
#   ./backup.sh systemd   # systemd 裸机部署
#
# 定时任务（每天凌晨2点）:
#   crontab -e
#   0 2 * * * /opt/fashion-inventory/cloud-deploy/scripts/backup.sh docker >> /var/log/fashion-backup.log 2>&1

set -e

DEPLOY_TYPE=${1:-docker}
BACKUP_DIR="/opt/fashion-inventory/backups"
KEEP_DAYS=14
TIMESTAMP=$(date +%F_%H%M)

# 确保备份目录存在
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup (type: $DEPLOY_TYPE)..."

if [ "$DEPLOY_TYPE" = "docker" ]; then
    # Docker 部署 - 从 volume 备份
    VOLUME_NAME="fashion-inventory_app_data"

    # 检查 volume 是否存在
    if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
        # 尝试自动检测 volume 名称
        VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep app_data | head -n1)
        if [ -z "$VOLUME_NAME" ]; then
            echo "[ERROR] Cannot find app_data volume"
            exit 1
        fi
        echo "[INFO] Detected volume: $VOLUME_NAME"
    fi

    BACKUP_FILE="$BACKUP_DIR/data-${TIMESTAMP}.db"

    # 使用临时容器从 volume 复制数据库文件
    docker run --rm \
        -v "$VOLUME_NAME:/data:ro" \
        -v "$BACKUP_DIR:/backup" \
        alpine sh -c "cp /data/data.db /backup/data-${TIMESTAMP}.db"

    echo "[$(date)] Backup created: $BACKUP_FILE"

elif [ "$DEPLOY_TYPE" = "systemd" ]; then
    # systemd 裸机部署 - 直接备份文件
    DB_FILE="/opt/fashion-inventory/prisma/data.db"
    BACKUP_FILE="$BACKUP_DIR/data-${TIMESTAMP}.db"

    if [ ! -f "$DB_FILE" ]; then
        echo "[ERROR] Database file not found: $DB_FILE"
        exit 1
    fi

    # 优先使用 sqlite3 在线备份
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
        echo "[$(date)] Backup created using sqlite3: $BACKUP_FILE"
    else
        # 降级为文件复制
        cp "$DB_FILE" "$BACKUP_FILE"
        echo "[$(date)] Backup created using cp (install sqlite3 for safer backups): $BACKUP_FILE"
    fi

else
    echo "[ERROR] Invalid deploy type: $DEPLOY_TYPE"
    echo "Usage: $0 {docker|systemd}"
    exit 1
fi

# 压缩备份文件
gzip -f "$BACKUP_FILE"
echo "[$(date)] Compressed: ${BACKUP_FILE}.gz"

# 清理旧备份
DELETED=$(find "$BACKUP_DIR" -name "data-*.db.gz" -mtime +${KEEP_DAYS} -delete -print | wc -l)
echo "[$(date)] Cleaned up $DELETED old backups (keep ${KEEP_DAYS} days)"

# 显示备份文件大小
BACKUP_SIZE=$(du -h "${BACKUP_FILE}.gz" | cut -f1)
echo "[$(date)] Backup size: $BACKUP_SIZE"

# 显示剩余备份数量
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "data-*.db.gz" | wc -l)
echo "[$(date)] Total backups: $BACKUP_COUNT"

echo "[$(date)] Backup completed successfully"

# 提示：同步到远程存储
echo ""
echo "⚠️  IMPORTANT: Remember to sync backups to remote storage!"
echo "Example commands:"
echo "  # Rsync to another server"
echo "  rsync -avz $BACKUP_DIR/ user@backup-server:/backups/fashion-inventory/"
echo ""
echo "  # Upload to cloud storage (rclone)"
echo "  rclone sync $BACKUP_DIR/ remote:fashion-inventory-backups/"
