import prisma from './src/config/prisma.config.js';
const contests = await prisma.contest.findMany({
  where: { isTest: false },
  orderBy: { startTime: 'asc' },
  select: { id: true, title: true, stream: true, difficulty: true, duration: true, startTime: true, isTest: true, createdAt: true },
});
console.log('Non-test contests:', contests.length);
contests.forEach(c => {
  const created = c.createdAt.toISOString().slice(0, 16);
  const start = c.startTime.toISOString().slice(0, 16);
  console.log(`  ${c.id.slice(0, 8)} | ${c.title.slice(0, 55)} | ${c.stream} | ${c.difficulty} | ${c.duration}m | start:${start} | created:${created} | isTest:${c.isTest}`);
});
await prisma.$disconnect();
