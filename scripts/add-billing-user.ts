
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: {
      email: "billing@careflow.demo",
    },
    update: {},
    create: {
      id: "demo-billing",
      email: "billing@careflow.demo",
      displayName: "Taylor Morgan",
      role: Role.BILLING,
      practiceId: "demo-practice",
    },
  });

  console.log("Billing demo user verified:", {
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  });
}

main()
  .catch((error) => {
    console.error("Failed to create billing demo user:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });