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
      desc: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING(20),
        defaultValue: "info", // success, warning, error, info
        allowNull: false,
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "is_read",
        allowNull: false,
      },
    },
    {
      tableName: "platform_notifications",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return PlatformNotification;
};
