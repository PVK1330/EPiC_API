export default (sequelize, DataTypes) => {
  const SlaRule = sequelize.define(
    "SlaRule",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      rule_type: {
        type: DataTypes.ENUM("Visa", "Global"),
        allowNull: false,
        defaultValue: "Visa",
      },
    },
    {
      tableName: "sla_rules",
      timestamps: true,
    }
  );

  return SlaRule;
};
