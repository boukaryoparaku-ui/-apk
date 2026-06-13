# Git 部署流

目标：本地改代码，推送到 GitHub；云服务器只负责拉取最新代码并用 Docker Compose 重建服务。

当前仓库远程地址：

```text
https://github.com/boukaryoparaku-ui/-apk.git
```

## 一、本地工作流

每次改完代码后，在本地执行：

```bash
npm test
npm run build
git status
git add .
git commit -m "描述本次修改"
git push origin main
```

注意：

- `.env`、数据库文件、`sessions/`、`backups/` 不要提交。
- 服务器上的 `.env` 单独保存，不会跟着 Git 覆盖。
- 业务数据在 Docker volume 里，不会因为重新构建镜像丢失。

## 二、服务器首次部署

SSH 登录服务器后，执行：

```bash
sudo apt-get update
sudo apt-get install -y git curl
git clone https://github.com/boukaryoparaku-ui/-apk.git /tmp/fashion-inventory-bootstrap
cd /tmp/fashion-inventory-bootstrap
sudo bash cloud-deploy/scripts/bootstrap-git.sh https://github.com/boukaryoparaku-ui/-apk.git
```

脚本会自动完成：

- 安装缺失的 Git / Docker
- clone 仓库到 `/opt/fashion-inventory`
- 生成 `/opt/fashion-inventory/.env`
- 生成随机 `SESSION_SECRET`、`AI_CONFIG_SECRET`、`ADMIN_PASSWORD`
- 执行 Docker Compose 构建和启动
- 检查 `/api/healthz`

部署完成后查看管理员密码：

```bash
sudo cat /opt/fashion-inventory/.env
```

访问：

```text
http://服务器IP:3001
```

## 三、服务器后续更新

本地 `git push` 后，SSH 到服务器执行：

```bash
cd /opt/fashion-inventory
bash cloud-deploy/scripts/update.sh
```

等价手动命令：

```bash
cd /opt/fashion-inventory
git pull --ff-only origin main
docker compose -f cloud-deploy/docker-compose.prod.yml --env-file .env up -d --build
curl http://127.0.0.1:3001/api/healthz
```

## 四、常用服务器命令

查看状态：

```bash
cd /opt/fashion-inventory
docker compose -f cloud-deploy/docker-compose.prod.yml --env-file .env ps
```

查看日志：

```bash
cd /opt/fashion-inventory
docker compose -f cloud-deploy/docker-compose.prod.yml --env-file .env logs -f app
```

重启：

```bash
cd /opt/fashion-inventory
docker compose -f cloud-deploy/docker-compose.prod.yml --env-file .env restart app
```

停止：

```bash
cd /opt/fashion-inventory
docker compose -f cloud-deploy/docker-compose.prod.yml --env-file .env down
```

## 五、服务器上不要直接改代码

建议服务器只改 `.env`，不要手动改源码。

如果服务器脚本提示“工作区有未提交改动”，查看：

```bash
cd /opt/fashion-inventory
git status --short
```

如果确认服务器上的源码改动不需要保留，再处理掉这些改动后更新。不要删除 `.env`、数据库 volume 或备份目录。

## 六、推荐日常节奏

1. 本地用 Codex / VS Code 修改。
2. 本地运行 `npm test && npm run build`。
3. 本地 `git add . && git commit && git push`。
4. 服务器执行 `bash cloud-deploy/scripts/update.sh`。
5. 浏览器打开系统确认功能。
