import db from '../models/index.js';
import bcrypt from 'bcryptjs';

export default async function seedAdmin() {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 12);

    const [admin, created] = await db.User.findOrCreate({
      where: { email: 'admin@elitepic.com' },
      defaults: {
        first_name: 'Super',
        last_name: 'Admin',
        email: 'admin@elitepic.com',
        country_code: '+1',
        mobile: '1234567890',
        password: hashedPassword,
        role_id: 1,            // maps to "admin" role
        is_otp_verified: true,
        is_email_verified: true,
        status: 'active',
      },
    });

    if (created) {
      console.log('✔ Admin user created → admin@elitepic.com / admin123');
    } else {
      console.log('✔ Admin user already exists');
    }
  } catch (err) {
    console.error('Admin seeder failed:', err.message);
  }
}
