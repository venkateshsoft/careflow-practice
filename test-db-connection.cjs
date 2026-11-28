require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function testConnection() {
  try {
    const result = await db.$queryRaw`SELECT 1`;
    console.log("DATABASE_URL query succeeded:", result);
  } catch (error) {
    console.error("DATABASE_URL query failed:", error.message);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

testConnection();
