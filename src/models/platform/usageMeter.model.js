export default (sequelize, DataTypes) => {
  const UsageMeter = sequelize.define(
    "UsageMeter",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      organisation_id: { type: DataTypes.INTEGER, allowNull: false },
      period_year: { type: DataTypes.INTEGER, allowNull: false },
      period_month: { type: DataTypes.INTEGER, allowNull: false },
      cases_created: { type: DataTypes.INTEGER, defaultValue: 0 },
      active_users: { type: DataTypes.INTEGER, defaultValue: 0 },
      storage_bytes: { type: DataTypes.BIGINT, defaultValue: 0 },
      api_calls: { type: DataTypes.INTEGER, defaultValue: 0 },
      workers_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    { tableName: "usage_meters", underscored: true }
  );
  return UsageMeter;
};
