const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const codes = await prisma.procedureCode.findMany({
    where: { isActive: true },
    select: { code: true, description: true, category: true },
    orderBy: { code: "asc" }
  });
  console.log(JSON.stringify(codes, null, 2));
}

main().finally(() => prisma.$disconnect());
