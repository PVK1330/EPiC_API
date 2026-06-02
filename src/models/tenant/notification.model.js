export default (sequelize, DataTypes) => {
  // Canonical column names match the notifications table:
  //   006_core_business_tables.sql + 20260516170000 (organisation_id)
  //   + 20260601130000 (category, action_url, is_archived).
  // Recipient is `userId` / `roleId` (NOT recipient_id / recipient_role).
  // Timestamps are camelCase `createdAt` / `updatedAt` (NOT snake_case).
  const Notification = sequelize.define(
    "Notification",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Recipient (FK to users.id). Column is "userId".
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "userId",
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      // Optional role target (FK to roles.id). Column is "roleId".
      roleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "roleId",
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // VARCHAR in the table — modelled as STRING (allowed values enforced in
      // the service/controller, not via a DB ENUM type).
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "info",
      },
      priority: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "medium",
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "system",
      },
      // Machine-readable action discriminator (column "actionType").
      actionType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "actionType",
      },
      entityType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "entityType",
      },
      entityId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "entityId",
      },
      actionUrl: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "action_url",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
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
        allowNull: false,
        defaultValue: false,
        field: "is_archived",
      },
      sendEmail: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
        field: "send_email",
      },
      emailSent: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
        field: "email_sent",
      },
      scheduledFor: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "scheduled_for",
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
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
      },
    },
    {
      tableName: "notifications",
      timestamps: true, // createdAt / updatedAt — matches the table column names
      indexes: [
        { fields: ["userId"] },
        { fields: ["category"] },
        { fields: ["is_read"] },
        { fields: ["is_archived"] },
        { fields: ["entityId", "entityType"] },
      ],
    }
  );

  return Notification;
};
