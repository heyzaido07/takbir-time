import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedMosque {
  name: string;
  nameArabic?: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  addressLine1?: string;
  amenities?: string[];
  verified?: boolean;
  capacity?: number;
  yearEstablished?: number;
  timings: {
    fajr: string;
    dhuhr: string;
    asr: string;
    maghrib: string;
    isha: string;
    jummah?: string[];
  };
}

const mosques: SeedMosque[] = [
  {
    name: 'Faisal Mosque',
    nameArabic: 'مسجد فيصل',
    latitude: 33.7295,
    longitude: 73.0372,
    city: 'Islamabad',
    country: 'Pakistan',
    addressLine1: 'Shah Faisal Ave, E-8',
    amenities: ['parking', 'wudhu', 'women_section', 'wheelchair_access'],
    verified: true,
    capacity: 100000,
    yearEstablished: 1986,
    timings: { fajr: '05:00', dhuhr: '13:30', asr: '17:00', maghrib: '18:45', isha: '20:15', jummah: ['13:30'] },
  },
  {
    name: 'Badshahi Mosque',
    nameArabic: 'بادشاہی مسجد',
    latitude: 31.5882,
    longitude: 74.3094,
    city: 'Lahore',
    country: 'Pakistan',
    addressLine1: 'Walled City of Lahore',
    amenities: ['parking', 'wudhu', 'historic'],
    verified: true,
    capacity: 100000,
    yearEstablished: 1673,
    timings: { fajr: '05:10', dhuhr: '13:25', asr: '16:55', maghrib: '18:40', isha: '20:10', jummah: ['13:30'] },
  },
  {
    name: 'Tooba Mosque',
    nameArabic: 'مسجد طوبیٰ',
    latitude: 24.879,
    longitude: 67.0639,
    city: 'Karachi',
    country: 'Pakistan',
    addressLine1: 'Korangi Rd, Defence',
    amenities: ['parking', 'wudhu', 'women_section'],
    verified: true,
    capacity: 5000,
    yearEstablished: 1969,
    timings: { fajr: '05:20', dhuhr: '13:15', asr: '16:45', maghrib: '18:30', isha: '20:00', jummah: ['13:15'] },
  },
  {
    name: 'Wazir Khan Mosque',
    latitude: 31.5832,
    longitude: 74.3232,
    city: 'Lahore',
    country: 'Pakistan',
    amenities: ['historic', 'wudhu'],
    verified: true,
    yearEstablished: 1641,
    timings: { fajr: '05:10', dhuhr: '13:25', asr: '16:55', maghrib: '18:40', isha: '20:10' },
  },
  {
    name: 'Masjid-e-Nabvi (Islamabad branch)',
    latitude: 33.7,
    longitude: 73.05,
    city: 'Islamabad',
    country: 'Pakistan',
    amenities: ['parking', 'wudhu', 'women_section'],
    timings: { fajr: '05:00', dhuhr: '13:30', asr: '17:00', maghrib: '18:45', isha: '20:15', jummah: ['13:30', '14:30'] },
  },
];

async function main() {
  console.log('🌱 Seeding...');

  // ensure PostGIS is enabled
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS postgis`);
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

  // wipe first (idempotent for dev). TRUNCATE mosques CASCADE also clears
  // `users` because `users.default_mosque_id` FKs back to mosques — so we
  // include users in the truncate list explicitly and re-create the demo user
  // afterward.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE timing_submissions, prayer_schedules, mosque_reviews, user_favorites, votes, mosques, users RESTART IDENTITY CASCADE`);

  // demo user (no Firebase UID — auth flows will create real users)
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@jamat.local' },
    update: {},
    create: {
      email: 'demo@jamat.local',
      fullName: 'Demo Contributor',
      reputationPoints: 50,
      verifiedContributor: true,
    },
  });
  console.log(`👤 demo user: ${demoUser.id}`);

  for (const m of mosques) {
    const inserted = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO mosques (
        name, name_arabic, location, latitude, longitude,
        address_line1, city, country, amenities,
        verified, capacity, year_established,
        added_by, created_at, updated_at
      ) VALUES (
        ${m.name}, ${m.nameArabic ?? null},
        ST_MakePoint(${m.longitude}, ${m.latitude})::geography,
        ${m.latitude}, ${m.longitude},
        ${m.addressLine1 ?? null}, ${m.city}, ${m.country}, ${m.amenities ?? []}::text[],
        ${m.verified ?? false}, ${m.capacity ?? null}, ${m.yearEstablished ?? null},
        ${demoUser.id}::uuid, NOW(), NOW()
      ) RETURNING id
    `;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.prayerSchedule.create({
      data: {
        mosqueId: inserted[0].id,
        timings: m.timings,
        validFrom: today,
        isActive: true,
        verificationStatus: 'verified',
        submittedById: demoUser.id,
        verifiedById: demoUser.id,
      },
    });

    console.log(`🕌 ${m.name}`);
  }

  console.log(`✅ Seeded ${mosques.length} mosques`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
