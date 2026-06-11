import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// SQLite 并发加固：
// - WAL: 读写并发，写入更快，避免多人同时录单时相互阻塞
// - busy_timeout: 遇到锁时最多等待 5 秒再重试，而不是立刻抛 SQLITE_BUSY
// - synchronous=NORMAL: WAL 下兼顾安全与性能的推荐档
// 仅对 SQLite 生效；启动时执行一次。
async function applySqlitePragmas() {
  try {
    // journal_mode=WAL 会返回一行结果（"wal"），必须用 $queryRawUnsafe；
    // $executeRawUnsafe 在 SQLite 下不允许返回结果，会抛 P2010。
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    await prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL;");
  } catch (err) {
    console.error("应用 SQLite PRAGMA 失败：", err);
  }
}

void applySqlitePragmas();

