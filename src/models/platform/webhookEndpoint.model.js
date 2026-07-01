export default (sequelize, DataTypes) => {
  const WebhookEndpoint = sequelize.define(
    "WebhookEndpoint",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      organisation_id: { type: DataTypes.INTEGER, allowNull: false },
      url: { type: DataTypes.TEXT, allowNull: false },
      secret: { type: DataTypes.STRING(255), allowNull: false },
      events: { type: DataTypes.ARRAY(DataTypes.TEXT), defaultValue: [] },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "webhook_endpoints", underscored: true }
  );
  return WebhookEndpoint;
};
