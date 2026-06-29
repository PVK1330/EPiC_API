export default (sequelize, DataTypes) => {
  const SponsoredWorker = sequelize.define(
    "SponsoredWorker",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      cosRequestId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "cos_request_id",
        references: { model: "cos_requests", key: "id" },
        onDelete: "SET NULL",
      },
      cosAllocationRecordId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "cos_allocation_record_id",
        references: { model: "cos_allocation_records", key: "id" },
        onDelete: "SET NULL",
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sponsor_id",
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
        onDelete: "SET NULL",
      },

      // ── Core identity ───────────────────────────────────────────────────────
      workerFirstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "worker_first_name",
      },
      workerLastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "worker_last_name",
      },
      workerEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "worker_email",
      },
      workerNationality: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "worker_nationality",
      },

      // ── UKVI personal details ───────────────────────────────────────────────
      dob: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      gender: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      maritalStatus: {
        type: DataTypes.STRING(30),
        allowNull: true,
        field: "marital_status",
      },

      // ── Passport / travel document ──────────────────────────────────────────
      passportNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "passport_number",
      },
      passportIssueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "passport_issue_date",
      },
      passportExpiryDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "passport_expiry_date",
      },
      passportCountry: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "passport_country",
      },

      // ── Contact ─────────────────────────────────────────────────────────────
      phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },

      // ── Employment / UKVI job details ───────────────────────────────────────
      jobTitle: {
        type: DataTypes.STRING(150),
        allowNull: true,
        field: "job_title",
      },
      department: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      socCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: "soc_code",
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "start_date",
      },
      salary: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      weeklyHours: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        field: "weekly_hours",
      },

      // ── Immigration history ─────────────────────────────────────────────────
      previousUkVisa: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "previous_uk_visa",
      },

      // ── CoS reference number (auto-generated at assignment time) ────────────
      workerCosNumber: {
        type: DataTypes.STRING(60),
        allowNull: true,
        unique: true,
        field: "worker_cos_number",
      },

      // ── Visa type ───────────────────────────────────────────────────────────
      visaType: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "visa_type",
      },

      // ── Workflow ────────────────────────────────────────────────────────────
      status: {
        type: DataTypes.STRING(60),
        allowNull: false,
        defaultValue: "CoS Assigned",
      },
      assignedCaseworkerIds: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "assigned_caseworker_ids",
        defaultValue: [],
      },
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "rejection_reason",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "sponsored_workers",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      paranoid: true,
      deletedAt: "deleted_at",
    }
  );

  return SponsoredWorker;
};
