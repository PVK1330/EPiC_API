export default (sequelize, DataTypes) => {
  const NotificationTemplate = sequelize.define(
    "NotificationTemplate",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        comment: "Unique event code mapping to eventRegistry",
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "Notification title template (supports Handlebars/EJS tags)",
      },
      emailSubject: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "email_subject",
      },
      emailTemplate: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "email_template",
      },
      inAppTemplate: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "in_app_template",
        comment: "Notification message template",
      },
      smsTemplate: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "sms_template",
      },
    },
    {
      tableName: "notification_templates",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return NotificationTemplate;
};
