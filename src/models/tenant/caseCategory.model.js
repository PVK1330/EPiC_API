export default (sequelize, DataTypes) => {
  const CaseCategory = sequelize.define(
    "CaseCategory",
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
    },
    {
      tableName: "case_categories",
      timestamps: true,
    }
  );

  return CaseCategory;
};
