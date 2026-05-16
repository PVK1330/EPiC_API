export default (sequelize, DataTypes) => {
  const PetitionType = sequelize.define(
    "PetitionType",
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
      tableName: "petition_types",
      timestamps: true,
    }
  );

  return PetitionType;
};
