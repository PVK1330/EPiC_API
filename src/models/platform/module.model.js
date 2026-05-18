export default (sequelize, DataTypes) => {
  const Module = sequelize.define(
    "Module",
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
      label: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      panel: {
        type: DataTypes.ENUM("admin", "caseworker", "candidate", "business"),
        allowNull: false,
      },
      icon: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      sort_order: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "modules",
      timestamps: true,
    }
  );

  return Module;
};
