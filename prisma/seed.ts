import { PrismaClient, Role, AppointmentStatus } from "@prisma/client";

const prisma = new PrismaClient();
const day = (offset: number, hour: number) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); d.setHours(hour); return d;
};

async function main() {
  const practice = await prisma.practice.upsert({ where: { id: "demo-practice" }, update: {}, create: { id: "demo-practice", name: "Harborview Family Medicine", timezone: "America/New_York" } });
  await prisma.user.createMany({ data: [
    { id: "demo-admin", email: "admin@careflow.demo", displayName: "Jordan Lee", role: Role.ADMIN, practiceId: practice.id },
    { id: "demo-provider", email: "provider@careflow.demo", displayName: "Dr. Morgan Reyes", role: Role.PROVIDER, practiceId: practice.id },
    { id: "demo-frontdesk", email: "frontdesk@careflow.demo", displayName: "Avery Chen", role: Role.RECEPTIONIST, practiceId: practice.id },
  ], skipDuplicates: true });
  const provider = await prisma.provider.upsert({ where: { id: "demo-provider-profile" }, update: {}, create: { id: "demo-provider-profile", displayName: "Dr. Morgan Reyes", specialty: "Family Medicine", credential: "MD", practiceId: practice.id } });
  const patients = await Promise.all([
    ["CF-10001", "Taylor", "Nguyen", "1988-04-12", "(555) 010-0142"],
    ["CF-10002", "Riley", "Brooks", "1975-09-28", "(555) 010-0188"],
    ["CF-10003", "Casey", "Patel", "1996-11-03", "(555) 010-0127"],
  ].map(([mrn, firstName, lastName, dateOfBirth, phone]) => prisma.patient.upsert({ where: { mrn }, update: {}, create: { mrn, firstName, lastName, dateOfBirth: new Date(dateOfBirth), phone, practiceId: practice.id } })));
  if (await prisma.appointment.count({ where: { practiceId: practice.id } }) === 0) {
    await prisma.appointment.createMany({ data: patients.map((patient, i) => ({ startsAt: day(0, 9 + i * 2), visitType: ["Annual wellness", "Follow-up", "New patient"][i], status: AppointmentStatus.SCHEDULED, patientId: patient.id, providerId: provider.id, practiceId: practice.id })) });
  }
  console.log("Seeded synthetic CareFlow demo data.");
}
main().finally(() => prisma.$disconnect());
