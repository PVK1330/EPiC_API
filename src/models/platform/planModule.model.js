export default (sequelize, DataTypes) => {
  const PlanModule = sequelize.define(
    "PlanModule",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      plan_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "plans",
          key: "id",
        },
      },
      module_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "modules",
          key: "id",
        },
      },
    },
    {
      tableName: "plan_modules",
      timestamps: true,
      updatedAt: false,
    }
  );

  return PlanModule;
};
