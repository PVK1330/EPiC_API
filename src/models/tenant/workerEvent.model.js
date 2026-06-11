export default (sequelize, DataTypes) => {
  const WorkerEvent = sequelize.define(
    "WorkerEvent",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      workerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      caseId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "cases",
          key: "id",
        },
      },
      // Tenant/organisation scope. Nullable + ON DELETE SET NULL at the DB level
      // so removing an organisation never cascades into worker-event history.
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: {
          model: "organisations",
          key: "id",
        },
      },
      eventType: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      eventDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      reportedDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      deadlineDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "reported", "overdue"),
        allowNull: false,
        defaultValue: "pending",
      },
      reportedBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      evidenceFile: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      dateReportedToSms: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      description: {
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
      tableName: "worker_events",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return WorkerEvent;
};
