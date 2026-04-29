export default (sequelize, DataTypes) => {
  const SponsorUserPreference = sequelize.define(
    "SponsorUserPreference",
    {
      userId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      email_notifications: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      compliance_updates: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      payment_reminders: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sms_alerts: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      push_notifications: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      timezone: {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: "UTC+0 (London)",
      },
      language: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "English",
      },
      date_format: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "DD/MM/YYYY",
      },
    },
    {
      tableName: "sponsor_user_preferences",
      timestamps: true,
    }
  );

  return SponsorUserPreference;
};
