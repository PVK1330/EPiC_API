-- Initial Users table for Platform Registry
CREATE TABLE IF NOT EXISTS "users" (
    "id" SERIAL PRIMARY KEY,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "country_code" VARCHAR(10) NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "password" TEXT NOT NULL,
    "otp_code" VARCHAR(10),
    "otp_expiry" TIMESTAMP WITH TIME ZONE,
    "is_otp_verified" BOOLEAN DEFAULT FALSE,
    "temp_password" TEXT,
    "role_id" INTEGER NOT NULL,
    "is_email_verified" BOOLEAN DEFAULT FALSE,
    "status" VARCHAR(20) DEFAULT 'active' NOT NULL,
    "password_reset_otp" VARCHAR(10),
    "password_reset_otp_expiry" TIMESTAMP WITH TIME ZONE,
    "two_factor_secret" TEXT,
    "two_factor_enabled" BOOLEAN DEFAULT FALSE,
    "two_factor_backup_codes" JSONB,
    "profile_pic" VARCHAR(500),
    "gender" VARCHAR(20) DEFAULT 'other',
    "organisation_id" INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mobile_unique ON users (country_code, mobile);
