-- BUG-012: Add structured medical treatment detail columns to candidate_applications (idempotent)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS "medicalTreatmentHospitalClinicName" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "medicalTreatmentHospitalClinicAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "medicalTreatmentStartDate" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "medicalTreatmentEndDate" TIMESTAMP WITH TIME ZONE;
