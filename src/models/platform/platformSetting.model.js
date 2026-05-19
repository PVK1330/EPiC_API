export default (sequelize, DataTypes) => {
  const PlatformSetting = sequelize.define(
    "PlatformSetting",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "platform_settings",
      timestamps: true,
    }
  );

  return PlatformSetting;
};
