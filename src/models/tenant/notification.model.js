export default (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    "Notification",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      roleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "roles",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "Optional: If set, notification is for all users with this role",
      },
      type: {
        type: DataTypes.ENUM(
          "info",
          "success",
          "warning",
          "error",
          "case_created",
          "case_updated",
          "case_assigned",
          "case_status_changed",
          "payment_received",
          "payment_overdue",
          "document_uploaded",
          "document_reviewed",
          "message_received",
          "escalation_created",
          "escalation_resolved",
          "user_created",
          "user_status_changed",
          "system_maintenance",
          "sla_breach",
          "task_assigned",
          "licence_assigned",
          "licence_status_changed",
          "licence_info_requested"
        ),
        allowNull: false,
        defaultValue: "info",
      },
      priority: {
        type: DataTypes.ENUM("low", "medium", "high", "urgent"),
        allowNull: false,
        defaultValue: "medium",
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      actionType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Type of action that triggered this notification",
      },
      entityId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "ID of the related entity (case, user, document, etc.)",
      },
      entityType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Type of the related entity (case, user, document, etc.)",
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "Additional data for the notification",
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
      sendEmail: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "send_email",
        comment: "Whether to send this notification via email",
      },
      emailSent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "email_sent",
      },
      scheduledFor: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "scheduled_for",
        comment: "If set, notification will be sent at this time",
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "sent_at",
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "expires_at",
        comment: "Optional: Notification will be auto-deleted after this time",
      },
    },
    {
      tableName: "notifications",
      timestamps: true,
      indexes: [
        {
          fields: ["userId"],
        },
        {
          fields: ["roleId"],
        },
        {
          fields: ["type"],
        },
        {
          fields: ["priority"],
        },
        {
          fields: ["is_read"],
        },
        {
          fields: ["scheduled_for"],
        },
        {
          fields: ["entityId", "entityType"],
        },
      ],
    }
  );

  return Notification;
};
