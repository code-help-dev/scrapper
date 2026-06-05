/**
 * One-shot admin user seeder.
 * Run:  npm run seed:admin
 * Or:   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=Secret123 npm run seed:admin
 *
 * The first registered user is automatically set to ADMIN role.
 * If users already exist this script prints existing admin email and exits.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/modules/users/users.service';
import { UserRole } from '../src/common/enums/user-role.enum';

async function main() {
  // Silence NestJS bootstrap logs
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const usersService = app.get(UsersService);

  const email = process.env.ADMIN_EMAIL ?? 'admin@aajjo.local';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin@1234';

  const count = await usersService.countAll();

  if (count > 0) {
    console.log(`\n⚠️  Users already exist (total: ${count}). No new user created.`);
    console.log('   To add more users, log in as admin and POST /api/auth/register.\n');
    await app.close();
    return;
  }

  const user = await usersService.create(email, password, UserRole.ADMIN);
  console.log('\n✅  Admin user created successfully!');
  console.log(`   Email:    ${user.email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Role:     ${user.role}`);
  console.log('\n   Log in at the frontend or POST /api/auth/login\n');

  await app.close();
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err.message ?? err);
  process.exit(1);
});
