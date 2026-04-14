export default (sequelize, DataTypes) => {
  const AdminUserPreference = sequelize.define(
    "AdminUserPreference",
    {
      user_id: {
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
      avatar_url: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      two_factor_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      email_notifications: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      case_updates: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      payment_alerts: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      timezone: {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: "UTC-05:00 Eastern Time",
      },
      language: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "English",
      },
      date_format: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: "MM/DD/YYYY",
      },
      data_collection: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "admin_user_preferences",
      timestamps: true,
    }
  );

  return AdminUserPreference;
};
