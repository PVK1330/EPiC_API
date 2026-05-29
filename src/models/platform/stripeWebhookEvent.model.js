export default (sequelize, DataTypes) => {
  const StripeWebhookEvent = sequelize.define(
    "StripeWebhookEvent",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      event_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      event_type: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      stripe_account_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      processed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      processing_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'pending',
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      payload_hash: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "stripe_webhook_events",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return StripeWebhookEvent;
};
