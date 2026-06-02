export default (sequelize, DataTypes) => {
  const PlatformNotification = sequelize.define(
    "PlatformNotification",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      category: {
        type: DataTypes.ENUM(
          "system",
          "security",
          "billing",
          "workflow"
        ),
        allowNull: false,
        defaultValue: "system",
      },
      priority: {
        type: DataTypes.ENUM("low", "medium", "high", "critical"),
        allowNull: false,
        defaultValue: "medium",
      },
      type: {
        type: DataTypes.ENUM("info", "success", "warning", "error"),
        allowNull: false,
        defaultValue: "info",
      },
      recipientId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "recipient_id",
      },
      recipientRole: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "recipient_role",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
      },
      entityType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "entity_type",
      },
      entityId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "entity_id",
      },
      actionUrl: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "action_url",
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "is_read",
      },
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "read_at",
      },
      isArchived: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "is_archived",
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
      }
    },
    {
      tableName: "platform_notifications",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["recipient_id"] },
        { fields: ["is_read"] },
        { fields: ["category"] },
      ],
    }
  );

  return PlatformNotification;
};
