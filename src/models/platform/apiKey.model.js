export default (sequelize, DataTypes) => {
  const ApiKey = sequelize.define(
    "ApiKey",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      organisation_id: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      key_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      key_prefix: { type: DataTypes.STRING(12), allowNull: false },
      scopes: { type: DataTypes.ARRAY(DataTypes.TEXT), defaultValue: [] },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      last_used_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "api_keys", underscored: true }
  );
  return ApiKey;
};
