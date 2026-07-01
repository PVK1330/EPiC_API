/**
 * MonthlyComplianceReview — one row per organisation per calendar month.
 *
 * Stores a frozen JSON snapshot of the five Section N sections:
 *   1. complianceSummary  — worker counts, risk breakdown, licence status
 *   2. workersExpiring    — workers whose visa expires within 90 days
 *   3. reportingHistory   — aggregate of compliance review actions in the period
 *   4. missingDocuments   — workers missing required compliance documents
 *   5. riskMovement       — comparison of risk scores vs the previous month
 *
 * The `payload` JSONB column stores the full report object; top-level scalar
 * columns (totalWorkers, highRiskCount, etc.) are denormalised for fast list
 * queries without deserialising the whole payload.
 */
export default (sequelize, DataTypes) => {
  const MonthlyComplianceReview = sequelize.define(
    "MonthlyComplianceReview",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },

      // Sponsor (BUSINESS role user) this report was generated for.
      // NULL for org-wide reports triggered by an admin / cron.
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "sponsor_id",
        references: { model: "users", key: "id" },
      },

      // The month this report covers, stored as the first day of that month.
      // e.g. 2025-06-01 for the June 2025 report.
      reportMonth: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: "report_month",
      },

      // Top-level denormalised counts for the list view.
      totalWorkers: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "total_workers",
      },
      highRiskCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "high_risk_count",
      },
      mediumRiskCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "medium_risk_count",
      },
      workersExpiringIn90Days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "workers_expiring_in_90_days",
      },
      missingDocumentCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "missing_document_count",
      },

      // Overall risk score this month (0–100, higher = worse).
      riskScore: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        field: "risk_score",
      },
      // Delta vs last month's riskScore (+positive = worse, -negative = improved).
      riskScoreDelta: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        field: "risk_score_delta",
      },

      // How the report was created: 'cron' (automatic) or 'manual' (on-demand).
      generatedBy: {
        type: DataTypes.ENUM("cron", "manual"),
        allowNull: false,
        defaultValue: "cron",
        field: "generated_by",
      },

      // Full five-section report payload — JSONB on Postgres, JSON on MySQL.
      payload: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "monthly_compliance_reviews",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      indexes: [
        { fields: ["organisation_id", "report_month"], unique: false },
        { fields: ["sponsor_id", "report_month"], unique: false },
      ],
    },
  );

  return MonthlyComplianceReview;
};
