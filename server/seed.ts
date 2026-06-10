import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

export async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const existing = await prisma.user.findUnique({ where: { username } });

  if (!existing) {
    await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, 10)
      }
    });
  }
}
