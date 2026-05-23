-- Create unverified_users table for candidate self-registration flow.
-- Rows are deleted once the OTP is verified and the user is promoted to users.

CREATE TABLE IF NOT EXISTS "unverified_users" (
  "id"              SERIAL PRIMARY KEY,
  "first_name"      VARCHAR(100)             NOT NULL,
  "last_name"       VARCHAR(100)             NOT NULL,
  "email"           VARCHAR(255)             NOT NULL,
  "country_code"    VARCHAR(10)              NOT NULL,
  "mobile"          VARCHAR(20)              NOT NULL,
  "password"        TEXT                     NOT NULL,
  "otp_code"        VARCHAR(10),
  "otp_expiry"      TIMESTAMP WITH TIME ZONE,
  "temp_password"   TEXT,
  "date_of_birth"   DATE,
  "role_id"         INTEGER                  NOT NULL
                      REFERENCES "roles" ("id")
                      ON UPDATE CASCADE ON DELETE CASCADE,
  "organisation_id" INTEGER
                      REFERENCES "organisations" ("id")
                      ON UPDATE CASCADE ON DELETE SET NULL,
  "createdAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unverified_users_country_code_mobile_key"
    UNIQUE ("country_code", "mobile")
);
