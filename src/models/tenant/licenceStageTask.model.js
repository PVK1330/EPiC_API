export default (sequelize, DataTypes) => {
  /**
   * Per-stage, per-role task for a sponsor licence application.
   *
   * One row per (licence application, stage, role) — see the UNIQUE index — so
   * each of Sponsor / Caseworker / Admin / Candidate has their own assignable,
   * completable task at every lifecycle stage. Drives the interactive stages
   * panel; notifications (in-app + email) fire as rows are assigned/completed.
   */
  const LicenceStageTask = sequelize.define(
    "LicenceStageTask",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },
      stageKey: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "stage_key",
      },
      stageOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "stage_order",
      },
      // sponsor | caseworker | admin | candidate
      role: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      title: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      assignedToUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "assigned_to_user_id",
        references: { model: "users", key: "id" },
      },
      assigneeName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "assignee_name",
      },
      assigneeEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "assignee_email",
      },
      // pending | in_progress | completed | blocked
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending",
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "completed_at",
      },
      completedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "completed_by_user_id",
        references: { model: "users", key: "id" },
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "due_date",
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "licence_stage_tasks",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { unique: true, fields: ["licence_application_id", "stage_key", "role"] },
      ],
    }
  );

  return LicenceStageTask;
};
