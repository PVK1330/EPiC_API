export default (sequelize, DataTypes) => {
  const VisaType = sequelize.define(
    "VisaType",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "visa_types",
      timestamps: true,
    }
  );

  return VisaType;
};
