# 云服务器部署方案包

本项目包含完整的云服务器部署方案，位于 `cloud-deploy/` 目录。

## 📦 部署包位置

```
cloud-deploy/          # 云服务器部署完整方案
```

## 🚀 快速开始

### 方法1：查看部署包导航

```bash
cd cloud-deploy
cat 开始部署.md
```

### 方法2：直接阅读主文档

```bash
cd cloud-deploy
cat README.md
```

## 📚 包含内容

✅ **完整文档**
- 主部署文档（README.md）
- 5分钟快速开始指南
- Docker 详细部署文档
- systemd 裸机部署文档
- 安全加固指南

✅ **配置文件**
- Docker Compose 生产配置
- Dockerfile 镜像构建文件
- 环境变量模板
- Nginx 反向代理配置
- Caddy 反向代理配置
- systemd 服务配置

✅ **维护脚本**
- 数据库备份脚本（支持 Docker 和 systemd）
- 一键部署脚本
- 更新脚本

## 🎯 两种部署方式

### Docker 部署（推荐）
- 适合大多数云服务器
- 环境隔离、易于迁移
- 1核1G内存即可

### systemd 裸机部署
- 适合小内存服务器（512MB）
- 资源占用更低
- 需要手动安装 Node.js

## 📖 使用流程

1. 进入部署目录：`cd cloud-deploy`
2. 阅读快速导航：`cat 开始部署.md`
3. 选择部署方式并按文档操作
4. 完成安全加固（必需）

## 🔐 安全提醒

部署后必须：
- ✅ 修改所有默认密码和密钥
- ✅ 配置 HTTPS（公网访问）
- ✅ 设置防火墙
- ✅ 配置自动备份

详见 `cloud-deploy/docs/安全加固.md`

## 📋 文件清单

详细的文件说明请查看 `cloud-deploy/文件清单.md`

---

**开始部署**: `cd cloud-deploy && cat 开始部署.md`
