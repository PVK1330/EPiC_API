export default (sequelize, DataTypes) => {
  const NotificationPreference = sequelize.define(
    "NotificationPreference",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "user_id",
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
        unique: true, // One preference record per user
      },
      emailNotifications: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "email_notifications",
      },
      inAppNotifications: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "in_app_notifications",
      },
      // Category preferences
      caseUpdates: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "case_updates",
      },
      paymentNotifications: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "payment_notifications",
      },
      appointmentNotifications: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        field: "appointment_notifications",
      },
      marketingNotifications: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "marketing_notifications",
      },
    },
    {
      tableName: "notification_preferences",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return NotificationPreference;
};
