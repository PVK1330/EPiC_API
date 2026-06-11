export default (sequelize, DataTypes) => {
  /**
   * Immutable audit trail for licence applications.
   *
   * Captures both ASSIGNMENT HISTORY (admin assigning/reassigning caseworkers)
   * and REVIEWER ACTIONS (approve / reject / request information / under review).
   * One row per event; rows are never updated or deleted by the application.
   */
  const LicenceApplicationAudit = sequelize.define(
    "LicenceApplicationAudit",
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
        references: {
          model: "licence_applications",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      // The user who performed the event (admin assigning, or reviewing staff).
      actorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "actor_id",
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
      // assign | reassign | approve | reject | request_info | under_review | review
      action: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      previousStatus: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "previous_status",
      },
      newStatus: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "new_status",
      },
      // Snapshot of the assigned caseworker id list for assignment events.
      assignedCaseworkerIds: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "assigned_caseworker_ids",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "licence_application_audits",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  return LicenceApplicationAudit;
};
