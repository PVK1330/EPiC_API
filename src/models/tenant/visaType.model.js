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
