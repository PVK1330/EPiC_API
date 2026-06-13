export default (sequelize, DataTypes) => {
  const RightToWorkRecord = sequelize.define(
    "RightToWorkRecord",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      workerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "worker_id",
        references: {
          model: "users",
          key: "id",
        },
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
      initialCheckDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: "initial_check_date",
      },
      checkedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "checked_by",
        references: {
          model: "users",
          key: "id",
        },
      },
      referenceNumber: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "reference_number",
      },
      documentPath: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "document_path",
      },
      followUpCheckDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "follow_up_check_date",
      },
      status: {
        type: DataTypes.ENUM("valid", "expired", "pending_followup"),
        allowNull: false,
        defaultValue: "valid",
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
      tableName: "right_to_work_records",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return RightToWorkRecord;
};
