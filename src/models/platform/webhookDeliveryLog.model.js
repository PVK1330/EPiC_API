export default (sequelize, DataTypes) => {
  const WebhookDeliveryLog = sequelize.define(
    "WebhookDeliveryLog",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      webhook_endpoint_id: { type: DataTypes.INTEGER, allowNull: false },
      event_type: { type: DataTypes.STRING(100), allowNull: false },
      payload: { type: DataTypes.JSONB, defaultValue: {} },
      status: {
        type: DataTypes.ENUM("pending", "delivered", "failed", "retrying"),
        defaultValue: "pending",
      },
      response_status: { type: DataTypes.INTEGER, allowNull: true },
      response_body: { type: DataTypes.TEXT, allowNull: true },
      attempt_count: { type: DataTypes.INTEGER, defaultValue: 0 },
      next_retry_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "webhook_delivery_logs", underscored: true }
  );
  return WebhookDeliveryLog;
};
