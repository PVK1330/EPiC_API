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
      code: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: "Short code embedded in generated Case IDs (e.g. 'SW' in EPIC-SW26-001)",
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      cclTemplatePath: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "ccl_template_path",
      },
      cclTemplateName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "ccl_template_name",
      },
    },
    {
      tableName: "visa_types",
      timestamps: true,
    }
  );

  return VisaType;
};
