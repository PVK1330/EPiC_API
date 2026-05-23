export default (sequelize, DataTypes) => {
  const DataCaptureTemplate = sequelize.define(
    "DataCaptureTemplate",
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      visaTypeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "visa_type_id",
      },
      name: { type: DataTypes.STRING(255), allowNull: false },
      fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "is_active",
      },
    },
    {
      tableName: "data_capture_templates",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );
  return DataCaptureTemplate;
};
