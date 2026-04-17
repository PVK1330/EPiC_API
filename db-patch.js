import db from './src/models/index.js';

async function patch() {
  try {
    console.log("Starting DB Patch...");
    
    // 1. Create conversations table if not exists
    await db.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "conversations" (
        "id" SERIAL PRIMARY KEY,
        "participantOneId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "participantTwoId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "caseId" INTEGER REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        "lastMessage" TEXT,
        "lastMessageAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);
    console.log("✔ Conversations table verified/created.");

    // 2. Add conversationId to messages if not exists
    await db.sequelize.query(`
      ALTER TABLE "messages" 
      ADD COLUMN IF NOT EXISTS "conversationId" INTEGER REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `);
    console.log("✔ conversationId column added to messages.");

    // 3. Add messageType to messages if not exists
    await db.sequelize.query(`
      DO $$ BEGIN
        ALTER TABLE "messages" ADD COLUMN "messageType" VARCHAR(20) DEFAULT 'text';
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log("✔ messageType column added to messages.");

    console.log("Patch completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Patch failed:", error);
    process.exit(1);
  }
}

patch();
