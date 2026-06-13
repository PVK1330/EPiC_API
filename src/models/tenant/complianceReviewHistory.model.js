export default (sequelize, DataTypes) => {
  /**
   * Polymorphic, immutable history of sponsor-compliance review actions across
   * Right-to-Work checks, Worker Events and Change Requests (entity_type +
   * entity_id). One row per action: review, approve, reject, request_info,
   * respond. Never updated or deleted by the application.
   */
  const ComplianceReviewHistory = sequelize.define(
    "ComplianceReviewHistory",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      entityType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "entity_type",
      },
      entityId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "entity_id",
      },
      // The user who performed the action (reviewer for staff actions, sponsor
      // for `respond`).
      actorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "actor_id",
        references: { model: "users", key: "id" },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },
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
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "compliance_review_history",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  return ComplianceReviewHistory;
};
