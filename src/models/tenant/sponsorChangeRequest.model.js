export default (sequelize, DataTypes) => {
  const SponsorChangeRequest = sequelize.define(
    "SponsorChangeRequest",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sponsor_id",
        references: {
          model: "users",
          key: "id",
        },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: {
          model: "organisations",
          key: "id",
        },
      },
      changeType: {
        type: DataTypes.ENUM(
          "company_address",
          "ownership",
          "merger_acquisition",
          "key_personnel",
          "insolvency_risk",
          "trading_status"
        ),
        allowNull: false,
        field: "change_type",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      requestedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "requested_by",
        references: {
          model: "users",
          key: "id",
        },
      },
      status: {
        type: DataTypes.ENUM("pending", "submitted", "overdue"),
        allowNull: false,
        defaultValue: "pending",
      },
      eventDate: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "event_date",
      },
      reportingDeadline: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "reporting_deadline",
      },
      dateReported: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "date_reported",
      },
      reportedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "reported_by",
      },
      evidenceFile: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "evidence_file",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // ── Compliance review workflow (separate from operational `status`) ──
      reviewStatus: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "Submitted",
        field: "review_status",
      },
      reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "reviewed_by",
        references: { model: "users", key: "id" },
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "reviewed_at",
      },
      reviewNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "review_notes",
      },
    },
    {
      tableName: "sponsor_change_requests",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SponsorChangeRequest;
};
